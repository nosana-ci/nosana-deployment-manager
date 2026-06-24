import type { OutstandingTasksDocument } from "./task.js";

/**
 * Worker-thread IPC protocol: the messages a signer worker posts back to the
 * parent, and the data the parent passes in.
 */

export interface WorkerEventMessage {
  event: "CONFIRMED" | "ERROR" | string;
  error?: string;
  job: string;
  run: string;
  tx: string;
  /** Unit index this message refers to (API-key path / multi-unit tasks). */
  unit?: number;
}

/**
 * Discriminated union of messages a signer worker sends to the parent.
 *
 * SIGNED — self-custody: a unit's tx is signed (not yet sent); the parent
 *   persists it before broadcasting. No signature yet — it comes back from the
 *   send call.
 * CONFIRMED — API-key path: the worker already submitted and confirmed a unit.
 * ERROR — a unit (or the worker) failed.
 * DONE — sentinel posted last; the channel is FIFO so its arrival means every
 *   prior unit message has been delivered.
 */
export type SignedUnitMessage = {
  event: "SIGNED";
  unit: number;
  blob: string;
  lastValidBlockHeight: number;
  /** Pre-computed tx signature (signBatch yields it up front; persisted before send). */
  signature?: string;
  /** Job addresses this bucket creates/targets — LIST bulks N, STOP/EXTEND one. */
  jobs?: string[];
  /** Run addresses, index-aligned with `jobs` (LIST). */
  runs?: string[];
};

export type ConfirmedUnitMessage = {
  event: "CONFIRMED";
  unit?: number;
  job?: string;
  run?: string;
  /**
   * Confirming signature. Optional because a batch confirmation can be a terminal
   * no-op (an EXTEND/STOP of an already-settled job did nothing on-chain), which
   * carries no `tx`. A genuine LIST/EXTEND/STOP that landed always has one.
   */
  tx?: string;
};

export type ErrorUnitMessage = {
  event: "ERROR";
  unit?: number;
  error?: string;
};

/**
 * RETRY — API-key path: the op is in-flight or got no definitive response, so it
 * is neither confirmed nor failed. The parent leaves the task for reclaim, which
 * re-issues the SAME deterministic idempotency key and the CM de-duplicates.
 */
export type RetryUnitMessage = {
  event: "RETRY";
  unit?: number;
  /** CM `Retry-After` backoff hint (ms) for the in-flight reschedule, if given. */
  retryAfterMs?: number;
};

export type DoneMessage = { event: "DONE" };

export type WorkerMessage =
  | SignedUnitMessage
  | ConfirmedUnitMessage
  | ErrorUnitMessage
  | RetryUnitMessage
  | DoneMessage;

export type WorkerData = {
  task: OutstandingTasksDocument;
  /**
   * Task `_id` as a hex string. Passed explicitly because the ObjectId on `task`
   * does not survive the structured clone into the worker thread, and the API
   * path needs it to build the deterministic `taskId:unit:epoch` idempotency key.
   */
  taskId: string;
  vault: string;
  confidential_ipfs_pin: string;
  /**
   * Number of jobs the signer should produce this run (parent-decided); the
   * signer packs them into the fewest size/CU-bounded txs.
   */
  count?: number;
  /** Unit index to assign to the first produced unit (for reclaim top-up). */
  startUnit?: number;
  /**
   * Fixed total replica slots for the task (LIST). The API path issues only the
   * slots in `0..target-1` that have no CONFIRMED record yet, so a partial-success
   * reclaim re-issues just the unconfirmed slots instead of every slot.
   */
  target?: number;
  /**
   * Frozen ordered set of job addresses a STOP task targets (from the task's
   * `stop_targets`). The API batch path sends this exact set under one stable
   * idempotency key; the self-custody path stops each in turn.
   */
  stopTargets?: string[];
};
