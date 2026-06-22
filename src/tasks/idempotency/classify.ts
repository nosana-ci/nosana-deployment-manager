/**
 * Machine codes the Credit Manager attaches to a coded idempotency error. They
 * arrive on the thrown `ApiError.code` (the kit's `errorFormatter` lifts the
 * response body's `code` onto the Error), so the DM discriminates on these
 * rather than on HTTP status or message text.
 */
export const IdempotencyCode = {
  /** Same key replayed with a different payload — a client bug, never retried. */
  PAYLOAD_MISMATCH: "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH",
  /** The stored signed tx is provably dead (past its blockhash); re-post under a fresh epoch. */
  EXPIRED: "IDEMPOTENCY_KEY_EXPIRED",
  /** The op is mid-flight (slow confirm / concurrent duplicate); retry the SAME key later. */
  IN_PROGRESS: "IDEMPOTENCY_KEY_IN_PROGRESS",
} as const;

/**
 * What the caller should do with a failed idempotent request.
 *   - RETRY  — not landed yet, safe to re-issue the SAME key (reclaim the task).
 *   - EXPIRED — provably dead; bump the epoch and post a fresh tx.
 *   - FATAL  — a definitive client error; surface it, never retry.
 */
export type IdempotencyAction = "RETRY" | "EXPIRED" | "FATAL";

type CodedError = { code?: unknown; statusCode?: unknown };

function read(error: unknown): CodedError {
  return typeof error === "object" && error !== null ? (error as CodedError) : {};
}

/**
 * Classify a thrown idempotent-request error into the action the DM should take.
 *
 * A *lost response is indistinguishable from a slow confirm*, so anything without
 * a definitive HTTP response — network error, timeout, abort — is RETRY, never a
 * failure. A 5xx is likewise RETRY. Only a coded `EXPIRED` bumps the epoch; only
 * a coded fatal (or any other 4xx) is non-retryable. An unrecognised coded error
 * defaults to FATAL so a buggy reuse can't silently loop.
 */
export function classifyApiError(error: unknown): IdempotencyAction {
  const { code, statusCode } = read(error);

  if (code === IdempotencyCode.EXPIRED) return "EXPIRED";
  if (code === IdempotencyCode.IN_PROGRESS) return "RETRY";
  if (code === IdempotencyCode.PAYLOAD_MISMATCH) return "FATAL";

  // A definitive HTTP response: 5xx is transient (retry), other 4xx are fatal.
  if (typeof statusCode === "number") {
    return statusCode >= 500 ? "RETRY" : "FATAL";
  }

  // No response reached us (network / timeout / abort): could be a lost success,
  // so retry the same key and let the CM de-duplicate.
  return "RETRY";
}
