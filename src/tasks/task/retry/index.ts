import { DeploymentStatus } from "../../../types/index.js";
import type { DeploymentCollection, OutstandingTasksDocument } from "../../../types/index.js";
import { retryCooldownMs } from "../../utils/cooldown.js";

/**
 * What a handled task error tells us about how to retry it. A transient failure
 * no longer flips the deployment to terminal ERROR — instead the task is
 * rescheduled with an escalating cooldown and the deployment keeps doing what it
 * was doing (RUNNING / STOPPING). `InsufficientFundsForRent` is the one exception
 * we keep visible (it's actionable — top up the vault) and retry more slowly.
 */
export type RetrySignal = {
  insufficientFunds: boolean;
};

export function classifyTaskError(error: string): RetrySignal {
  return { insufficientFunds: error.includes("InsufficientFundsForRent") };
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

/**
 * Escalating reschedule delay, keyed off `inflight_retries` (the count of prior
 * non-crash retries). Honours the CM `Retry-After` hint as a floor.
 */
export function retryDelayMs(
  task: OutstandingTasksDocument,
  result: { retryAfterMs?: number },
  signal: RetrySignal | undefined
): number {
  const escalating = retryCooldownMs(task.inflight_retries ?? 0, signal?.insufficientFunds ?? false);
  return Math.max(result.retryAfterMs ?? 0, escalating);
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
