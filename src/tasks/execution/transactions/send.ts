import { getKit } from "../../../kit/index.js";
import { workerErrorFormatter } from "../../../worker/Worker.js";
import { trackSignature } from "../tracker/index.js";
import { isTransientSendError } from "./classifySendError.js";
import { UnitOutcome } from "./types.js";
import { TxRecord } from "../../../types/index.js";

type Rpc = ReturnType<typeof getKit>["solana"]["rpc"];
type SendTxParams = Parameters<Rpc["sendTransaction"]>;
type WireTransaction = SendTxParams[0];

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
  // spuriously rejected with "blockhash not found". Not every RPC honours
  // preflight, so the blob is simulated explicitly first (see `simulateUnit`).
  const rpc = getKit().solana.rpc;
  const blob = record.blob as WireTransaction;
  const simulated = await simulateUnit(rpc, blob);
  if (simulated) return { ...simulated, signature: record.signature || undefined };

  let signature: string;
  try {
    signature = await rpc
      .sendTransaction(blob, {
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

/** How long a simulation may take before the send goes ahead without it. */
const SIMULATE_TIMEOUT_MS = 10_000;

/** Program log lines kept in a simulation error: the last ones carry the reason. */
const SIMULATION_LOG_LINES = 3;

/**
 * Simulate a blob before broadcasting it. Preflight alone is not enough: some
 * RPCs (Ironforge, which prd uses) ignore it, return a signature and drop a
 * doomed tx, so an unfunded vault or a program error would only ever show as an
 * expiry. A deterministic failure is an ERROR carrying the simulation's reason;
 * an unknown blockhash is EXPIRED (re-sign). Null sends: a clean simulation, an
 * already-landed tx (the send dedups and the tracker confirms it), or a
 * simulation that could not run (preflight still applies where honoured).
 */
async function simulateUnit(
  rpc: Rpc,
  blob: WireTransaction
): Promise<{ result: "EXPIRED" } | { result: "ERROR"; error: string } | null> {
  const response = await rpc
    .simulateTransaction(blob, { encoding: "base64", commitment: "confirmed" })
    .send({ abortSignal: AbortSignal.timeout(SIMULATE_TIMEOUT_MS) })
    .catch((error: unknown) => {
      console.warn("[send] simulation failed to run, sending without it:", workerErrorFormatter(error));
      return null;
    });
  const err = response?.value.err;
  if (!err || err === "AlreadyProcessed") return null;
  if (err === "BlockhashNotFound") return { result: "EXPIRED" };

  const logs = (response?.value.logs ?? []).slice(-SIMULATION_LOG_LINES);
  const reason = JSON.stringify(err, (_key, value) => (typeof value === "bigint" ? value.toString() : value));
  return {
    result: "ERROR",
    error: `Transaction simulation failed: ${reason}${logs.length > 0 ? ` (${logs.join(" | ")})` : ""}`,
  };
}
