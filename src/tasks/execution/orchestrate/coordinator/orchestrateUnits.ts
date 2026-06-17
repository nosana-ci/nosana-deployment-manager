import { tally } from "../unit.js";
import { resumeExisting } from "./resumeExisting.js";
import { runWorkerMessages } from "../workerChannel.js";

import type { Worker } from "worker_threads";
import type { Collection, ObjectId } from "mongodb";

import type { UnitOutcome } from "../../transactions/index.js";
import type { TaskDocument, TxRecord } from "../../../../types/index.js";
import type { OrchestrateHandlers, OrchestrateResult, UnitContext } from "../types.js";


/**
 * Drive a set of transaction units to terminal state from up to two sources:
 * resumed `existing` records and/or a signer `worker`. Honours `signal`: on
 * abort, in-flight sends bail and `aborted: true` is returned so the caller
 * abandons the task for reclaim rather than completing it.
 */
export async function orchestrateUnits(args: {
  tasks: Collection<TaskDocument>;
  taskId: ObjectId;
  existing: TxRecord[];
  worker: Worker | null;
  signal: AbortSignal;
  handlers: OrchestrateHandlers;
}): Promise<OrchestrateResult> {
  const { tasks, taskId, existing, worker, signal, handlers } = args;
  const ctx: UnitContext = { tasks, taskId, handlers, signal };

  const outcomes: UnitOutcome[] = [];
  if (existing.length > 0) outcomes.push(...(await resumeExisting(ctx, existing)));
  if (worker) outcomes.push(...(await runWorkerMessages(ctx, worker)));

  return tally(outcomes, signal.aborted);
}