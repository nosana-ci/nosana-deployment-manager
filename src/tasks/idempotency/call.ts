import { buildIdempotencyKey } from "./key.js";
import { classifyApiError } from "./classify.js";

/**
 * Outcome of driving one unit's API call to a terminal state across epochs.
 *   - ok    — the CM confirmed (landed on-chain); `value` is the API response.
 *   - retry — mid-flight or no definitive response; reclaim the task and re-issue
 *             the SAME keys (the CM de-duplicates).
 *   - fatal — a definitive client error; the unit cannot succeed as posted.
 */
export type IdempotentCallResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "retry"; retryAfterMs?: number }
  | { kind: "fatal"; error: string };

function messageOf(error: unknown): string {
  if (error instanceof Error) return `${error.name} ${error.message}`;
  return typeof error === "object" ? JSON.stringify(error) : String(error);
}

/**
 * The CM surfaces an `IN_PROGRESS` backoff hint on `err.retryAfter` (an HTTP
 * `Retry-After`, in seconds). Convert it to ms for the in-flight reschedule;
 * absent/malformed → undefined so the caller falls back to its default.
 */
function retryAfterMsOf(error: unknown): number | undefined {
  const value = typeof error === "object" && error !== null
    ? (error as { retryAfter?: unknown }).retryAfter
    : undefined;
  const seconds = Number(value);
  return value != null && Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

/**
 * Drive a single unit's idempotent API call to a terminal {@link IdempotentCallResult}.
 *
 * Each attempt uses the deterministic key `taskId:unit:epoch`. On a provably-dead
 * `EXPIRED` the epoch is bumped and a fresh tx is posted under the next key (a
 * re-walk of already-expired epochs is cheap — the CM replays their stored dead
 * status without rebuilding). RETRY and FATAL are terminal for this run; epoch
 * exhaustion degrades to RETRY so the task reclaims rather than failing outright.
 */
export async function runIdempotentCall<T>(args: {
  taskId: string;
  unit: string | number;
  maxEpoch: number;
  attempt: (idempotencyKey: string) => Promise<T>;
}): Promise<IdempotentCallResult<T>> {
  const { taskId, unit, maxEpoch, attempt } = args;

  for (let epoch = 0; epoch <= maxEpoch; epoch++) {
    const key = buildIdempotencyKey(taskId, unit, epoch);
    try {
      return { kind: "ok", value: await attempt(key) };
    } catch (error) {
      const action = classifyApiError(error);
      if (action === "EXPIRED") continue; // dead tx: post a fresh one under the next epoch
      if (action === "RETRY") return { kind: "retry", retryAfterMs: retryAfterMsOf(error) };
      return { kind: "fatal", error: messageOf(error) };
    }
  }

  // Every epoch's tx expired in one run (degraded RPC/network): let the task
  // reclaim and try again rather than flagging the deployment failed.
  return { kind: "retry" };
}
