import { getKit } from "../../../kit/index.js";
import { SignatureStatusValue } from "./types.js";

/** getSignatureStatuses accepts at most 256 signatures per call. */
const STATUS_BATCH_SIZE = 256;

type Rpc = ReturnType<typeof getKit>["solana"]["rpc"];
type SignatureArg = Parameters<Rpc["getSignatureStatuses"]>[0][number];

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Batched `getSignatureStatuses` over an arbitrary set of signatures (≤256 per
 * RPC call). A signature absent from the returned map (not found, or a batch
 * that failed this call) is treated by callers as "still pending" — never as
 * confirmed or expired. Shared by the live sweep and one-shot recovery so both
 * classify on-chain state through exactly one code path.
 */
export async function fetchSignatureStatuses(
  signatures: string[]
): Promise<Map<string, SignatureStatusValue>> {
  const rpc = getKit().solana.rpc;
  const out = new Map<string, SignatureStatusValue>();
  for (const group of chunk(signatures, STATUS_BATCH_SIZE)) {
    try {
      const { value } = await rpc.getSignatureStatuses(group as SignatureArg[]).send();
      group.forEach((signature, index) => out.set(signature, value[index] ?? null));
    } catch {
      // Skip this batch; absent signatures are read as pending by the caller.
    }
  }
  return out;
}
