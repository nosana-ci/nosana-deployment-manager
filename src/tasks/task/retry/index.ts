import { DeploymentStatus } from "../../../types/index.js";
import type { DeploymentCollection, OutstandingTasksDocument } from "../../../types/index.js";
import { retryCooldownMs } from "../../utils/cooldown.js";

export { archiveBannedOwner } from "./archiveBannedOwner.js";

/**
 * What a handled task error tells us about how to retry it. A transient failure
 * no longer flips the deployment to terminal ERROR — instead the task is
 * rescheduled with an escalating cooldown and the deployment keeps doing what it
 * was doing (RUNNING / STOPPING). A funds shortfall is the one exception we keep
 * visible (it's actionable — top up the vault / credits) and retry more slowly:
 * both the on-chain rent error (`InsufficientFundsForRent`) and the client
 * manager's credit-exhaustion error (`Insufficient credits`) qualify.
 */
export type RetrySignal = {
  insufficientFunds: boolean;
  /**
   * The CM reported a NEGATIVE credit balance. A balance can only go below zero
   * when we've clawed an owner's credits back for foul play, so it condemns the
   * whole ACCOUNT — the runner archives every one of the owner's deployments
   * ({@link archiveBannedOwner}) instead of retrying. Never set for a zero or
   * positive balance (an ordinary shortfall the user can still top up).
   */
  negativeBalance?: boolean;
};

/** Substrings marking a funds/credit shortfall — retried on the slow funds ladder. */
const FUNDS_ERROR_MARKERS = ["InsufficientFundsForRent", "Insufficient credits"];

/**
 * Pull the signed `Available: $X` balance out of a CM credits error, tolerating
 * both `$-5.00` and `-$5.00`. Returns null when no balance is present, so a
 * non-credits error can never be read as negative.
 *
 * NOTE: production has only ever shown `Available: $0.000` (clamped) — validate
 * this against a real negative-balance event before trusting the sign.
 */
export function parseAvailableBalance(error: string): number | null {
  const m = error.match(/Available:\s*(-?)\$(-?)(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const value = Number(m[3]);
  if (!Number.isFinite(value)) return null;
  return m[1] === "-" || m[2] === "-" ? -value : value;
}

export function classifyTaskError(error: string): RetrySignal {
  const insufficientFunds = FUNDS_ERROR_MARKERS.some((marker) => error.includes(marker));
  const available = parseAvailableBalance(error);
  return {
    insufficientFunds,
    // Strictly `< 0`: a $0.000 shortfall is an ordinary top-up-able state, NOT a ban.
    negativeBalance: insufficientFunds && available !== null && available < 0,
  };
}

/**
 * Reschedule the run instead of completing it terminally when the lease is intact
 * and either an in-flight unit needs to be retried or a handled error was flagged.
 */
export function shouldRetry(
  result: { aborted: boolean; retry: boolean },
  signal: RetrySignal | undefined
): boolean {
  return !result.aborted && (result.retry || signal !== undefined);
}

/** Re-poll delay for an in-flight wait when the CM gave no `Retry-After` hint. */
const INFLIGHT_RETRY_DEFAULT_MS = 5_000;

/**
 * How long to wait before re-running a rescheduled task. Two distinct kinds:
 *
 *  - **Handled error** (`signal` set): a real failure, so back off on the
 *    escalating cooldown (honouring the CM `Retry-After` as a floor) — the
 *    deployment stays put and retries until the cap.
 *  - **In-flight wait** (`signal` undefined, i.e. CM `IN_PROGRESS` / a lost
 *    response): a legitimate "still working, retry shortly" — poll at the CM's
 *    suggested cadence (or a short default), NOT the escalating error backoff.
 *    Escalating here would re-poll so slowly that e.g. a stop of a running job
 *    never confirms before the job times out on its own.
 */
export function retryDelayMs(
  task: OutstandingTasksDocument,
  result: { retryAfterMs?: number },
  signal: RetrySignal | undefined
): number {
  if (signal) {
    const escalating = retryCooldownMs(task.inflight_retries ?? 0, signal.insufficientFunds);
    return Math.max(result.retryAfterMs ?? 0, escalating);
  }
  return result.retryAfterMs ?? INFLIGHT_RETRY_DEFAULT_MS;
}

/**
 * Stamp the deployment with the pending retry (soft `next_retry_at`, for UI /
 * tracing) and, for a funds failure, surface INSUFFICIENT_FUNDS — but only from a
 * live RUNNING deployment, so a STOPPING/STOPPED deployment is never clobbered.
 */
export async function applyRetryState(
  deployments: DeploymentCollection,
  deploymentId: string,
  signal: RetrySignal | undefined,
  delayMs: number
): Promise<void> {
  const next_retry_at = new Date(Date.now() + delayMs);
  if (signal?.insufficientFunds) {
    await deployments
      .updateOne(
        { id: deploymentId, status: DeploymentStatus.RUNNING },
        { $set: { status: DeploymentStatus.INSUFFICIENT_FUNDS } }
      )
      .catch((error) => console.error("[retry] failed to flag INSUFFICIENT_FUNDS", error));
  }
  await deployments
    .updateOne({ id: deploymentId }, { $set: { next_retry_at } })
    .catch((error) => console.error("[retry] failed to set next_retry_at", error));
}

/**
 * On a successful run that followed one or more retries, clear the soft retry
 * stamp and restore RUNNING from a visible INSUFFICIENT_FUNDS.
 */
export async function clearRetryState(
  deployments: DeploymentCollection,
  deploymentId: string
): Promise<void> {
  await deployments
    .updateOne(
      { id: deploymentId, status: DeploymentStatus.INSUFFICIENT_FUNDS },
      { $set: { status: DeploymentStatus.RUNNING } }
    )
    .catch((error) => console.error("[retry] failed to restore RUNNING", error));
  await deployments
    .updateOne({ id: deploymentId }, { $unset: { next_retry_at: "" } })
    .catch((error) => console.error("[retry] failed to clear next_retry_at", error));
}
