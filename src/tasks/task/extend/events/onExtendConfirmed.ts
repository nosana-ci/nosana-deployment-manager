import type { Db } from "mongodb";

import { scheduleTask } from "../../../scheduleTask.js";
import { getNextExtendTime } from "../../../utils/index.js";

import { TaskType } from "../../../../types/index.js";
import type { EventsCollection, OutstandingTasksDocument } from "../../../../types/index.js";

export async function onExtendConfirmed(
  events: EventsCollection,
  task: OutstandingTasksDocument,
  db: Db,
  signature: string,
  job: string
) {
  // A tx-less confirmation is a terminal no-op: the job has already settled
  // (stopped/completed), so the CM extended nothing. End the cycle here — do NOT
  // reschedule — otherwise a dead job would no-op-and-reschedule forever. (Before
  // the kit's terminal-no-op change this surfaced as a NOT_EXTENDABLE error, which
  // also stopped the cycle.)
  if (!signature) return;

  // Schedule the next cycle idempotently FIRST: if a crash hit after a prior
  // confirm but before this task was deleted, the reclaim re-runs this handler
  // against a CM replay — `idempotent` makes the re-schedule a no-op so we never
  // queue two extend cycles (a double-extend). Gate the success event on the same
  // signal so a replay doesn't double-log either.
  const scheduled = await scheduleTask(
    db,
    TaskType.EXTEND,
    task.deploymentId,
    task.deployment.status,
    getNextExtendTime(task.deployment.timeout, false),
    { job, idempotent: true }
  );

  if (!scheduled) return;

  await events.insertOne({
    deploymentId: task.deploymentId,
    category: "Deployment",
    type: "JOB_EXTEND_SUCCESSFUL",
    message: `Successfully extended job - TX ${signature}`,
    tx: signature,
    created_at: new Date(),
  });
}
