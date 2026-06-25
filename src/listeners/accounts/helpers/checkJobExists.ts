import { address } from "@solana/addresses";
import type { NosanaClient } from "@nosana/kit";

/**
 * @solana/errors codes meaning "the account simply isn't on-chain". `kit.jobs.get`
 * runs through `assertAccountExists`, which throws a `SolanaError` carrying
 * `context.__code` rather than a plain message — so we key off the code (as the
 * send-error classifier does) instead of matching a brittle message string.
 */
const ACCOUNT_NOT_FOUND_CODES = new Set<number>([
  3230000, //  SOLANA_ERROR__ACCOUNTS__ACCOUNT_NOT_FOUND
  32300001, // SOLANA_ERROR__ACCOUNTS__ONE_OR_MORE_ACCOUNTS_NOT_FOUND
]);

/** Does any `context.__code` along the error's `cause` chain mean "not found"? */
function isAccountNotFound(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && typeof current === "object" && depth < 6; depth++) {
    const code = (current as { context?: { __code?: unknown } }).context?.__code;
    if (typeof code === "number" && ACCOUNT_NOT_FOUND_CODES.has(code)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export async function checkJobExists(kit: NosanaClient, jobAddress: string): Promise<boolean> {
  try {
    await kit.jobs.get(address(jobAddress));
    return true;
  } catch (error) {
    if (isAccountNotFound(error)) {
      return false;
    }
    // Re-throw anything else (RPC/transport failures): a transient read error
    // must not be mistaken for "job gone" and silently mark it STOPPED.
    throw error;
  }
}
