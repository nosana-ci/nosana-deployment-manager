import { scheduleTask } from "../../tasks/scheduleTask.js";
import { JobsRepository } from "../../repositories/index.js";
import { disarmStartupDeadline } from "../infinite/utils/armStartupDeadline.js";

import { OnEvent, type StrategyListener } from "../../client/listener/types.js";
import {
  type DeploymentDocument,
  DeploymentDocumentFields,
  DeploymentStatus,
  DeploymentStrategy,
  JobState,
  TaskType,
} from "../../types/index.js";

/**
 * Moves a RUNNING deployment's jobs onto its new market. The update-market
 * route only writes the market; this listener — on the worker — does the swap.
 *
 * Every active job still on another market gets its own targeted STOP. A
 * targeted stop (`job` set) commits to exactly that job, so it can never take
 * one of the replacements whichever order the queue runs them in, and it skips
 * the full-stop housekeeping that would sweep the replacement LIST. Filtering
 * on the job's market rather than "everything active" also makes a repeat
 * event a no-op.
 *
 * The replacements come from wherever the strategy already lists — LIST reads
 * the deployment's market at claim time, so whatever lists next posts on the
 * new one:
 *   - SIMPLE / SIMPLE-EXTEND have no reconciliation of their own, so one LIST
 *     for the stopped count is queued here, ahead of the stops.
 *   - INFINITE refills each stopped replica through
 *     `infiniteJobStateCompletedOrStopUpdate`; a LIST here would overshoot.
 *   - SCHEDULED lists on its cron; the pending firing picks up the new market.
 *
 * A job still inside its startup window is disarmed first: the swap is not
 * evidence it would never have come online, so it must not feed the
 * startup-failure streak (and its deadline STOP would only duplicate ours).
 */
export const deploymentMarketUpdate: StrategyListener<DeploymentDocument> = [
  OnEvent.UPDATE,
  async ({ id, status, strategy, market }, db) => {
    const displaced = await JobsRepository.findAll(
      {
        deployment: id,
        market: { $ne: market },
        state: { $in: [JobState.QUEUED, JobState.RUNNING] },
      },
      { projection: { job: 1 } }
    );

    if (displaced.length === 0) return;

    if (
      strategy === DeploymentStrategy.SIMPLE ||
      strategy === DeploymentStrategy["SIMPLE-EXTEND"]
    ) {
      await scheduleTask(db, TaskType.LIST, id, status, new Date(), {
        limit: displaced.length,
      });
    }

    for (const { job } of displaced) {
      await disarmStartupDeadline(id, job);
      await scheduleTask(db, TaskType.STOP, id, status, new Date(), { job });
    }
  },
  {
    fields: [DeploymentDocumentFields.MARKET],
    filters: {
      status: { $eq: DeploymentStatus.RUNNING },
    },
  },
];
