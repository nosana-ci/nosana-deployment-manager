import { getKit } from "../../../kit/index.js";
import { workerErrorFormatter } from "../../../worker/Worker.js";
import { trackSignature } from "../tracker/index.js";
import { isTransientSendError } from "./classifySendError.js";
import { UnitOutcome } from "./types.js";
import { TxRecord } from "../../../types/index.js";

type Rpc = ReturnType<typeof getKit>["solana"]["rpc"];
type SendTxParams = Parameters<Rpc["sendTransaction"]>;

/**
 * Broadcast one signed blob, then wait for confirm/expire via the shared batched
 * tracker — one poll loop serves every in-flight tx in the process, not one loop
 * per unit. Used for freshly signed units and for resends flagged by recovery.
 *
 * Re-broadcasting an identical blob is safe: Solana dedups by signature, so a tx
 * lands at most once.
 */
export async function sendUnit(record: TxRecord, signal?: AbortSignal): Promise<UnitOutcome> {
  if (signal?.aborted) return { result: "ABORTED", signature: record.signature || undefined };

  // No blob to send and not already confirmed/reverted: treat as needing rebuild.
  if (!record.blob) return { result: "EXPIRED", signature: record.signature || undefined };

  // Broadcast the exact signed bytes promptly (blobs are perishable, so we never
  // queue them). Preflight runs (`skipPreflight: false`) so a deterministic
  // failure — insufficient funds, a program error — is caught here in ms with a
  // descriptive error, instead of silently never landing and only being declared
  // dead after the full ~60s blockhash window. `preflightCommitment: "confirmed"`
  // matches how recent blockhashes are fetched, so a freshly-signed tx isn't
  // spuriously rejected with "blockhash not found".
  const rpc = getKit().solana.rpc;
  let signature: string;
  try {
    signature = await rpc
      .sendTransaction(record.blob as SendTxParams[0], {
        encoding: "base64",
        skipPreflight: false,
        preflightCommitment: "confirmed",
        maxRetries: 0n,
      } as SendTxParams[1])
      .send();
  } catch (error) {
    // A transient RPC condition (node behind, rate limited, a blockhash the
    // preflight bank hasn't seen yet, a network blip) retries like a non-landing
    // tx so a node hiccup never errors the deployment. A deterministic preflight
    // failure (funds/program) is terminal — surfaced so the deployment reflects it.
    if (isTransientSendError(error)) {
      return { result: "EXPIRED", signature: record.signature || undefined };
    }
    return {
      result: "ERROR",
      signature: record.signature || undefined,
      error: workerErrorFormatter(error),
    };
  }

  const tracked = await trackSignature(signature, record.lastValidBlockHeight, signal);
  switch (tracked.outcome) {
    case "CONFIRMED":
      return { result: "CONFIRMED", signature };
    case "EXPIRED":
      return { result: "EXPIRED", signature };
    case "ABORTED":
      return { result: "ABORTED", signature };
    case "ERROR":
      return { result: "ERROR", signature, error: tracked.error ?? "transaction failed" };
  }
}
