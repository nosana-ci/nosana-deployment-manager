import { SignatureStatusValue } from "./types.js";

/** Interpret a single `getSignatureStatuses` value into confirmed/errored/pending. */
export function classifySignatureStatus(
  status: SignatureStatusValue | undefined
): { confirmed: boolean; error?: string } {
  if (!status) return { confirmed: false };
  if (status.err) return { confirmed: false, error: JSON.stringify(status.err) };
  return {
    confirmed:
      status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized",
  };
}
