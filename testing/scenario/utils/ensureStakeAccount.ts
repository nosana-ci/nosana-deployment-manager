import { NosanaClient } from "@nosana/kit";

/**
 * A node must own a stake account (even an empty one) before it can join a
 * market queue via `jobs.work`. On devnet the test key is pre-staked; a freshly
 * generated localnet wallet is not, so create a zero-amount stake account if one
 * doesn't already exist. Mirrors `@nosana/scenario`'s join-market-queue helper.
 */
export async function ensureStakeAccount(client: NosanaClient): Promise<void> {
  try {
    await client.stake.getByOwner();
  } catch {
    const instruction = await client.stake.stake({ amount: 0, days: 14 });
    await client.solana.buildSignAndSend(instruction);
  }
}
