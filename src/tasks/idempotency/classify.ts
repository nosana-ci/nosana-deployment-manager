import { IdempotencyCode, isNosanaApiError } from "@nosana/kit";

/**
 * The Credit Manager's idempotency control codes, re-exported from the kit so the
 * DM branches on the single source of truth. The kit keeps these in lockstep with
 * the client-manager OpenAPI spec (a compile-time assertion), so a drift between
 * the CM and what we match on becomes a build error rather than a silent
 * misclassification — which is why we no longer hardcode the strings here.
 */
export { IdempotencyCode };

/**
 * What the caller should do with a failed idempotent request.
 *   - RETRY  — not landed yet, safe to re-issue the SAME key (reclaim the task).
 *   - EXPIRED — provably dead; bump the epoch and post a fresh tx.
 *   - FATAL  — a definitive client error; surface it, never retry.
 */
export type IdempotencyAction = "RETRY" | "EXPIRED" | "FATAL";

/**
 * Classify a thrown idempotent-request error into the action the DM should take.
 *
 * A *lost response is indistinguishable from a slow confirm*, so anything without
 * a definitive HTTP response — network error, timeout, abort — is RETRY, never a
 * failure. The kit's {@link isNosanaApiError} guard is precisely that distinction:
 * it is false unless a numeric `statusCode` came back from the server. Only a
 * coded `EXPIRED` bumps the epoch; only a coded fatal (or any other 4xx) is
 * non-retryable; a 5xx is transient. An unrecognised coded 4xx defaults to FATAL
 * so a buggy reuse can't silently loop.
 */
export function classifyApiError(error: unknown): IdempotencyAction {
  // No response reached us (network / timeout / abort): could be a lost success,
  // so retry the same key and let the CM de-duplicate.
  if (!isNosanaApiError(error)) return "RETRY";

  if (error.code === IdempotencyCode.EXPIRED) return "EXPIRED";
  if (error.code === IdempotencyCode.IN_PROGRESS) return "RETRY";
  if (error.code === IdempotencyCode.PAYLOAD_MISMATCH) return "FATAL";

  // A definitive HTTP response with no (or an unrecognised) code: 5xx is
  // transient (retry), any other 4xx is a definitive client error (fatal).
  return error.statusCode >= 500 ? "RETRY" : "FATAL";
}
