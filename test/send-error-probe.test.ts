import { describe, it, expect } from "vitest";
import { createNosanaClient, generateKeyPairSigner } from "@nosana/kit";

import { isTransientSendError } from "../src/tasks/execution/transactions/classifySendError.js";
import { workerErrorFormatter } from "../src/worker/Worker.js";

// Probe the REAL localnet RPC to confirm the send-error classifier matches what
// the chain actually returns. Run with localnet up:
//   docker compose -f node_modules/@nosana/localnet/docker/docker-compose.yml up -d --wait
//   npx vitest run test/send-error-probe.test.ts
const RPC = process.env.SOLANA_RPC ?? "http://127.0.0.1:8899";
const WS = process.env.SOLANA_WS ?? "ws://127.0.0.1:8900";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function clientWith(wallet: any) {
  const kit = createNosanaClient("localnet", {
    solana: { rpcEndpoint: RPC, wsEndpoint: WS },
  });
  kit.wallet = wallet;
  return kit;
}

// The exact call shape the DM uses in send.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function sendWithPreflight(kit: any, signed: any) {
  const blob = kit.solana.serializeTransaction(signed);
  return kit.solana.rpc
    .sendTransaction(blob, {
      encoding: "base64",
      skipPreflight: false,
      preflightCommitment: "confirmed",
      maxRetries: 0n,
    })
    .send();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function captureSendError(kit: any, signed: any): Promise<unknown> {
  try {
    await sendWithPreflight(kit, signed);
    return undefined;
  } catch (error) {
    return error;
  }
}

function safeStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? `${v}n` : v));
  } catch (e) {
    return `<<unserializable: ${(e as Error).message}>>`;
  }
}

function report(label: string, error: unknown) {
  const e = error as { name?: string; message?: string; context?: unknown; cause?: unknown };
  console.log(`\n=== ${label} ===`);
  console.log("workerErrorFormatter :", workerErrorFormatter(error));
  console.log("name                 :", e?.name);
  console.log("message              :", e?.message);
  console.log("context              :", safeStringify(e?.context));
  console.log("cause                :", safeStringify(e?.cause));
  console.log("=> isTransientSendError:", isTransientSendError(error));
}

// Opt-in: needs localnet up and waits ~80s for a blockhash to expire, so it's
// excluded from the normal `npm test`. Run it after touching the classifier:
//   npm run localnet:up
//   RPC_PROBE=true npx vitest run test/send-error-probe.test.ts
describe.runIf(process.env.RPC_PROBE === "true")("send-error classification vs real localnet RPC", () => {
  it("unfunded fee payer (insufficient funds) -> TERMINAL", async () => {
    const wallet = await generateKeyPairSigner();
    const kit = await clientWith(wallet);
    const dest = await generateKeyPairSigner();

    const ix = await kit.solana.transfer({ to: dest.address, amount: 1, from: wallet });
    const signed = await kit.solana.signTransaction(await kit.solana.buildTransaction(ix));

    const error = await captureSendError(kit, signed);
    expect(error, "send should have failed (no funds for fee)").toBeDefined();
    report("INSUFFICIENT FUNDS", error);
    expect(isTransientSendError(error)).toBe(false); // terminal -> deployment errors
  }, 60_000);

  it("expired blockhash -> TRANSIENT (retry)", async () => {
    const wallet = await generateKeyPairSigner();
    const kit = await clientWith(wallet);
    await kit.solana.airdrop({ recipient: wallet.address, amount: 1_000_000_000n });
    const dest = await generateKeyPairSigner();

    const ix = await kit.solana.transfer({ to: dest.address, amount: 1, from: wallet });
    const signed = await kit.solana.signTransaction(await kit.solana.buildTransaction(ix));

    // A blockhash is valid ~150 slots (~60s). Let it expire so preflight rejects
    // it with "Blockhash not found" — the transient case the classifier must catch.
    await new Promise((r) => setTimeout(r, 80_000));

    const error = await captureSendError(kit, signed);
    expect(error, "send should have failed (blockhash expired)").toBeDefined();
    report("EXPIRED BLOCKHASH", error);
    expect(isTransientSendError(error)).toBe(true); // transient -> retry, not a deployment error
  }, 120_000);
});
