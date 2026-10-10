import type { Collection, Document, ObjectId } from "mongodb";

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
   * Reserved node each job was assigned to, index-aligned with `jobs` (LIST,
   * self-custody). With the task's `reservation` it is the record of which
   * reserved nodes were already used, so no node is assigned twice.
   */
  nodes?: string[];
  /** Each node's market, index-aligned with `nodes` (recorded for assigned jobs). */
  markets?: string[];
  /**
   * @deprecated Pre-bulking single-job shape. Read through `recordJobs`/
   * `recordRuns` so a record persisted by an older replica still resolves its
   * job(s) across a rolling deploy; never written going forward.
   */
  job?: string;
  run?: string;
};

/** A node host-manager holds for a LIST task, and the market it is queued in. */
export type ReservedNode = { node: string; market: string };

/**
 * The nodes host-manager filled a LIST task's reservation request with (its key
 * is the task id), persisted before anything is signed. Within the hold a
 * reclaim reuses them; once every node is used or the hold lapsed, what is
 * still missing is handed to a new LIST task with a request of its own.
 */
export type TaskReservation = {
  /** When host-manager releases the hold; null when nothing was reserved. */
  expiresAt: Date | null;
  nodes: ReservedNode[];
};

/**
 * Marks a LIST task's pending reservation request (key: the task id). Recorded
 * before it is sent, so the webhook always finds it, and cleared once it is
 * filled. Each renewal sends the deployment's current terms; host-manager
 * answers 409 when they no longer match the request, and the task hands off.
 */
export type TaskReservationRequest = {
  /** When host-manager first answered `waiting`; unset until then. */
  since?: Date;
};

export type TaskDocument = {
  task: TaskType;
  due_at: Date;
  deploymentId: string;
  tx: string | undefined | null;
  active_revision?: number;
  limit?: number;
  job?: string;
  /**
   * One-shot EXTEND: when present the worker extends the job by exactly this many
   * seconds (instead of `deployment.timeout * 60`) and `onExtendConfirmed` does
   * NOT reschedule a follow-up cycle. Used to re-align a running job to an
   * increased deployment timeout (see `applyTimeoutIncrease`) without starting an
   * extend chain on strategies that don't have one (INFINITE).
   */
  extend_seconds?: number;
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
  /**
   * Frozen ordered set of job addresses a STOP task commits to stopping, fixed on
   * the first attempt. The API batch path sends this exact set under one stable
   * idempotency key on every reclaim — a shrinking payload would be
   * `IDEMPOTENCY_KEY_PAYLOAD_MISMATCH` — and the CM treats an already-settled job
   * as a confirmed no-op, so a job that ends between attempts never fails the batch.
   */
  stop_targets?: string[];
  /**
   * IPFS hash of the job definition a LIST task posts, frozen on the first
   * attempt. With SSH keys configured the definition is re-pinned with the keys
   * merged in, so it must be fixed per task: the API batch path sends it under a
   * stable idempotency key on every reclaim (a changed hash would be
   * `IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`), and every slot of one task should run
   * the same definition.
   */
  ipfs_definition_hash?: string;
  /** Latest node reservation of a LIST task (self-custody). */
  reservation?: TaskReservation;
  /** Pending reservation request of a LIST task, cleared once it is fulfilled. */
  reservation_request?: TaskReservationRequest;
  /**
   * The LIST task this one took a shortfall over from. It is part of that
   * task's round (a SCHEDULED one fires no cron of its own) and is created once
   * per source task, however often the source is reclaimed.
   */
  handoff_of?: ObjectId;
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

/**
 * A claimed task hydrated with its deployment, vault, jobs and revisions.
 * `jobs` holds only QUEUED/RUNNING jobs and `revisions` is stripped of
 * `job_definition` — see `enrichClaimedTasks`.
 */
export type OutstandingTasksDocument = Document &
  TaskDocument & {
    deployment: Omit<DeploymentDocument, "vault"> & {
      vault: VaultDocument;
    };
    jobs: JobsDocument[];
    revisions: Omit<RevisionDocument, "job_definition">[];
  };

export type TaskFinishedReason = "COMPLETED" | "FAILED" | "TIMEOUT";

/**
 * Result of running a claimed task.
 *   - ABORTED — lease killed mid-run; left in Mongo to be reclaimed (counts as a
 *     crash-loop attempt).
 *   - RETRY — an API-path unit is in-flight / got no definitive response; the
 *     task is rescheduled after `retryAfterMs` WITHOUT counting as a crash, and
 *     re-issues the same idempotency key (CM de-dupes).
 *   - PARKED — a LIST waits for host-manager to fill its reservation request:
 *     due again after `reservation_renew_ms` to renew it (or sooner, when the
 *     webhook fills it), counting neither as an attempt nor as an in-flight retry.
 */
export type TaskRunResult = {
  outcome: "COMPLETED" | "FAILED" | "ABORTED" | "RETRY" | "PARKED";
  successCount: number;
  /** Delay (ms) before the in-flight retry becomes claimable; RETRY only. */
  retryAfterMs?: number;
};
