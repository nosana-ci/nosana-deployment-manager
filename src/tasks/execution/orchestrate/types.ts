import { Collection, ObjectId } from "mongodb";

import { TaskDocument } from "../../../types/index.js";

export type OrchestrateResult = {
  confirmed: number;
  errored: number;
  /** Lease killed mid-run: reclaim and re-run (counts as a crash-loop attempt). */
  aborted: boolean;
  /**
   * An API-path unit is in-flight / got no definitive response: reschedule (NOT
   * a crash) and re-issue the same idempotency key. Distinct from `aborted` so a
   * legitimate wait doesn't burn the crash-loop budget. `aborted` takes priority.
   */
  retry: boolean;
  /** CM `Retry-After` hint (ms) — the max across in-flight units this run. */
  retryAfterMs?: number;
};

export type OrchestrateHandlers = {
  /** Idempotent bookkeeping for a confirmed unit (e.g. upsert the job). */
  onConfirmed: (unit: number, signature: string, job?: string, run?: string) => void | Promise<void>;
  /**
   * Record a failed unit (event + flag deployment). `signature` is present when
   * the failure is a landed-but-reverted tx, so the event can record it for
   * tracing.
   */
  onError: (unit: number, error: string, signature?: string) => void | Promise<void>;
};

/** Everything the per-unit drivers need: the task doc to update + bookkeeping. */
export type UnitContext = {
  tasks: Collection<TaskDocument>;
  taskId: ObjectId;
  handlers: OrchestrateHandlers;
  signal: AbortSignal;
};
