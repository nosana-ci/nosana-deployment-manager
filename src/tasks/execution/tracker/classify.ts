import { SignatureStatusValue } from "./types.js";

/**
 * `JSON.stringify` replacer that survives `BigInt` values. `@solana/kit`
 * deserializes u64 fields in transaction errors (e.g. `InstructionError`
 * payloads) as `BigInt`, which would otherwise make `JSON.stringify` throw
 * `TypeError: Do not know how to serialize a BigInt`.
 */
function bigintSafe(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

/** Interpret a single `getSignatureStatuses` value into confirmed/errored/pending. */
export function classifySignatureStatus(
  status: SignatureStatusValue | undefined
): { confirmed: boolean; error?: string } {
  if (!status) return { confirmed: false };
  if (status.err) return { confirmed: false, error: JSON.stringify(status.err, bigintSafe) };
  return {
    confirmed:
      status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized",
  };
}
