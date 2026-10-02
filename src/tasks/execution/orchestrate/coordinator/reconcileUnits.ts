import type { Worker } from "worker_threads";
import type { Collection, ObjectId } from "mongodb";

import type { OrchestrateHandlers, OrchestrateResult } from "../types.js";
import type { TaskDocument, TxRecord } from "../../../../types/index.js";
import { orchestrateUnits } from "./orchestrateUnits.js";


/**
 * Reconcile a task to a fixed `target` number of confirmed units: resume any
 * prior-attempt records, then top up the shortfall with freshly signed units
 * from a worker. Shared by the LIST and EXTEND runners (EXTEND is just
 * `target = 1`); STOP doesn't reconcile (its units are derived from live jobs).
 */
export async function reconcileUnits(args: {
  tasks: Collection<TaskDocument>;
  taskId: ObjectId;
  existing: TxRecord[];
  target: number;
  signal: AbortSignal;
  handlers: OrchestrateHandlers;
  /**
   * Builds the signer worker for `count` fresh units starting at `startUnit`.
   * May be async (LIST reserves nodes first) and may return null when there is
   * nothing to sign this run.
   */
  makeWorker: (count: number, startUnit: number) => Worker | null | Promise<Worker | null>;
}): Promise<OrchestrateResult> {
  const { tasks, taskId, existing, target, signal, handlers, makeWorker } = args;

  const resume = existing.length
    ? await orchestrateUnits({ tasks, taskId, existing, worker: null, signal, handlers })
    : { confirmed: 0, errored: 0, aborted: signal.aborted, retry: false };
  if (resume.aborted) return resume;

  const needed = Math.max(0, target - resume.confirmed);
  if (needed === 0) return resume;

  const fresh = await orchestrateUnits({
    tasks,
    taskId,
    existing: [],
    worker: await makeWorker(needed, existing.length),
    signal,
    handlers,
  });

  // RETRY only ever comes from the fresh worker (the resume path is on-chain
  // recovery, which never yields RETRY), but combine both for completeness.
  return {
    confirmed: resume.confirmed + fresh.confirmed,
    errored: resume.errored + fresh.errored,
    aborted: fresh.aborted,
    retry: resume.retry || fresh.retry,
    retryAfterMs: fresh.retryAfterMs ?? resume.retryAfterMs,
  };
}
