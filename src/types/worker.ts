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
  job?: string;
  run?: string;
};

export type ConfirmedUnitMessage = {
  event: "CONFIRMED";
  unit?: number;
  job?: string;
  run?: string;
  tx: string;
};

export type ErrorUnitMessage = {
  event: "ERROR";
  unit?: number;
  error?: string;
};

export type DoneMessage = { event: "DONE" };

export type WorkerMessage =
  | SignedUnitMessage
  | ConfirmedUnitMessage
  | ErrorUnitMessage
  | DoneMessage;

export type WorkerData = {
  task: OutstandingTasksDocument;
  vault: string;
  confidential_ipfs_pin: string;
  /** Number of units the signer should produce this run (parent-decided). */
  count?: number;
  /** Unit index to assign to the first produced unit (for reclaim top-up). */
  startUnit?: number;
};
