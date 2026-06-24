import { workerErrorFormatter } from "../../../worker/Worker.js";

/**
 * @solana/errors error codes (stable public identifiers) that mean "retry",
 * not "this tx is doomed". A preflight failure surfaces as an outer
 * SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE
 * (-32002) whose `.message` is just "Transaction simulation failed" — the
 * discriminating code lives in the `.cause`. So we walk the cause chain and key
 * off the code rather than the (uninformative) message.
 *
 * Confirmed against the live RPC (see test/send-error-probe.test.ts):
 *   - unfunded fee payer -> cause __code 7050003 (ACCOUNT_NOT_FOUND)  -> terminal
 *   - expired blockhash  -> cause __code 7050008 (BLOCKHASH_NOT_FOUND) -> transient
 */
const TRANSIENT_ERROR_CODES = new Set<number>([
  7050008, // SOLANA_ERROR__TRANSACTION_ERROR__BLOCKHASH_NOT_FOUND — resign with a fresh blockhash
  -32005, //  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_NODE_UNHEALTHY — node behind, retry
]);

/**
 * Transport/string fallbacks for errors that carry no Solana code (raw fetch
 * failures, rate limiting) or that surface the reason in the message.
 */
const TRANSIENT_SIGNALS = [
  "blockhash not found",
  "node is behind",
  "node is unhealthy",
  "too many requests",
  "rate limit",
  "timed out",
  "timeout",
  "econnreset",
  "econnrefused",
  "etimedout",
  "socket hang up",
  "fetch failed",
];

/** Collect every `context.__code` along the error's `cause` chain. */
function collectErrorCodes(error: unknown): number[] {
  const codes: number[] = [];
  let current: unknown = error;
  for (let depth = 0; current && typeof current === "object" && depth < 6; depth++) {
    const code = (current as { context?: { __code?: unknown } }).context?.__code;
    if (typeof code === "number") codes.push(code);
    current = (current as { cause?: unknown }).cause;
  }
  return codes;
}

/**
 * Is this broadcast/preflight error a transient RPC condition (retry) rather
 * than a deterministic tx failure (terminal)? Defaults to terminal — matching
 * the pre-preflight behaviour where any send throw failed the unit — and only
 * carves out known-transient codes/signals.
 */
export function isTransientSendError(error: unknown): boolean {
  if (collectErrorCodes(error).some((code) => TRANSIENT_ERROR_CODES.has(code))) {
    return true;
  }
  const message = workerErrorFormatter(error).toLowerCase();
  return TRANSIENT_SIGNALS.some((signal) => message.includes(signal));
}
