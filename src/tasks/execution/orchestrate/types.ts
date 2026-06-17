import { Collection, ObjectId } from "mongodb";

import { TaskDocument } from "../../../types/index.js";

export type OrchestrateResult = {
  confirmed: number;
  errored: number;
  aborted: boolean;
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
