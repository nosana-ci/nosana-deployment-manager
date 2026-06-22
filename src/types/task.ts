import type { Collection, Document } from "mongodb";

import type { DeploymentDocument } from "./deployment.js";
import type { VaultDocument } from "./vault.js";
import type { JobsDocument } from "./job.js";
import type { RevisionDocument } from "./revision.js";

export const TaskType = {
  LIST: "LIST",
  EXTEND: "EXTEND",
  STOP: "STOP",
} as const;

export type TaskType = (typeof TaskType)[keyof typeof TaskType];

/**
 * Lifecycle status of a task document.
 *
 * Phase 1 uses only PENDING (claimable) and PROCESSING (claimed, lease held).
 * A leased queue is at-least-once: a PROCESSING task whose `lease_expires_at`
 * has passed (the owning consumer crashed) becomes claimable again. Dead-letter
 * retention (`DEAD`) is a Phase 2 feature.
 */
export const TaskStatus = {
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
} as const;

export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

/**
 * Per-on-chain-transaction idempotency state, persisted on the task BEFORE the
 * transaction is broadcast. On reclaim, the parent uses this to decide whether
 * the prior attempt already landed (confirmed), is provably dead (current block
 * height past `lastValidBlockHeight`, so safe to rebuild), or is still in-flight
 * (resend the same `blob`). A LIST task carries one record per replica slot;
 * EXTEND/STOP carry one per stopped/extended job.
 */
export const TxRecordStatus = {
  SIGNED: "SIGNED", // signed + persisted, not yet (re)sent
  SENT: "SENT", // broadcast, awaiting confirmation
  CONFIRMED: "CONFIRMED", // landed on-chain
} as const;

export type TxRecordStatus = (typeof TxRecordStatus)[keyof typeof TxRecordStatus];

export type TxRecord = {
  /** Stable index of this unit within the task (0 for single-tx tasks). */
  unit: number;
  signature: string;
  lastValidBlockHeight: number;
  status: TxRecordStatus;
  /**
   * Base64 serialized signed transaction, used to re-broadcast the identical
   * (signature-deduped) tx within its blockhash window. Nulled once the tx
   * confirms or its blockhash expires, to bound how long a broadcastable
   * artifact lives at rest.
   */
  blob?: string | null;
  /**
   * Public job addresses this unit creates/targets. A bulked LIST tx packs N
   * jobs into one unit (one per `accounts.jobs` entry); STOP/EXTEND carry one.
   */
  jobs?: string[];
  /** Public run addresses, index-aligned with `jobs` (recorded for LIST). */
  runs?: string[];
  /**
   * @deprecated Pre-bulking single-job shape. Read through `recordJobs`/
   * `recordRuns` so a record persisted by an older replica still resolves its
   * job(s) across a rolling deploy; never written going forward.
   */
  job?: string;
  run?: string;
};

export type TaskDocument = {
  task: TaskType;
  due_at: Date;
  deploymentId: string;
  tx: string | undefined | null;
  active_revision?: number;
  limit?: number;
  job?: string;
  created_at: Date;
  // --- state machine (Phase 1) ---
  status: TaskStatus;
  /** Number of times this task has been claimed; bounds crash-loop reclaim. */
  attempts: number;
  /**
   * Consecutive in-flight retries (API-path IN_PROGRESS / transient / lost
   * response). Counted separately from `attempts` — these are legitimate waits,
   * not crashes — and bounded by `task_max_inflight_retries`.
   */
  inflight_retries?: number;
  /** Identifier of the consumer currently holding the lease. */
  claimed_by?: string;
  /** Visibility timeout; while in the future the task is hidden from claims. */
  lease_expires_at?: Date | null;
  /** Per-tx idempotency records (persist-before-send). */
  transactions?: TxRecord[];
  /**
   * How many units (on-chain txs) this task should ultimately confirm, fixed on
   * the first attempt. Reclaim signs `target_count - confirmed` more, so partial
   * progress tops up instead of restarting or overshooting.
   */
  target_count?: number;
};

export type TasksCollection = Collection<TaskDocument>;

/**
 * Per-deployment advisory lock (its own `task_locks` collection) serializing
 * mutating tasks for one deployment across consumers. Carries a lease so a
 * crashed holder's lock is reclaimable.
 */
export type DeploymentLockDocument = {
  _id: string; // deploymentId
  holder: string;
  expires_at: Date;
};

export type DeploymentLocksCollection = Collection<DeploymentLockDocument>;

/** A claimed task hydrated with its deployment, vault, jobs and revisions. */
export type OutstandingTasksDocument = Document &
  TaskDocument & {
    deployment: Exclude<DeploymentDocument, "vault"> & {
      vault: VaultDocument;
    };
    jobs: JobsDocument[];
    revisions: RevisionDocument[];
  };

export type TaskFinishedReason = "COMPLETED" | "FAILED" | "TIMEOUT";

/**
 * Result of running a claimed task.
 *   - ABORTED — lease killed mid-run; left in Mongo to be reclaimed (counts as a
 *     crash-loop attempt).
 *   - RETRY — an API-path unit is in-flight / got no definitive response; the
 *     task is rescheduled after `retryAfterMs` WITHOUT counting as a crash, and
 *     re-issues the same idempotency key (CM de-dupes).
 */
export type TaskRunResult = {
  outcome: "COMPLETED" | "FAILED" | "ABORTED" | "RETRY";
  successCount: number;
  /** Delay (ms) before the in-flight retry becomes claimable; RETRY only. */
  retryAfterMs?: number;
};
