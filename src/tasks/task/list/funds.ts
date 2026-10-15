import { createNosanaApi } from "@nosana/kit";

import { listMarkets, type HostManagerMarket } from "../../../client/hostManager/index.js";
import { getConfig } from "../../../config/index.js";
import { getKit } from "../../../kit/index.js";
import { decryptWithKey } from "../../../vault/decrypt.js";

import type { OutstandingTasksDocument } from "../../../types/index.js";

/** The market type a deployment with no market is served from, and the only one credits pay for. */
const PREMIUM = "PREMIUM";

/** NOS base units per NOS (6 decimals), the unit of the on-chain job price. */
const NOS_UNITS = 1_000_000;

/** Lamports per SOL, for messages. */
const LAMPORTS = 1_000_000_000;

/** The job and run accounts a self-custody assign creates, and pays the rent of (jobs program sizes). */
const ASSIGN_ACCOUNT_SIZES = [233n, 113n];

/** Lamports kept for an assign's transaction fee on top of the rent (base + priority, generously). */
const ASSIGN_FEE_LAMPORTS = 100_000n;

/** A budget per node for host-manager: only markets priced within it are reserved. */
export type ListBudget = { maxUsdPerHour?: number } | { maxJobPrice?: number };

/**
 * What the deployment's vault can pay for before any node is reserved:
 *   - affordable   — ask for `count` (at most what was needed) under `budget`.
 *   - insufficient — not even one job in the cheapest market it could get.
 *   - fatal        — never payable as configured (credits on a non-premium market).
 */
export type FundsCheck =
  | { kind: "affordable"; count: number; budget: ListBudget }
  | { kind: "insufficient"; error: string }
  | { kind: "fatal"; error: string };

/**
 * Check the vault can pay for `count` jobs of the deployment's timeout in the
 * cheapest market it could be given (its own, or any premium one), so an
 * unfunded vault never holds a node. Credits are read from client-manager,
 * a self-custody vault's NOS and SOL from chain; prices from host-manager. The
 * balance is a snapshot, not a promise: an assign can still fail, which the
 * LIST run backs off from. A check that cannot be made (host-manager, chain
 * or client-manager down, an unpriced market) gives null, and the request is
 * made unchecked: this guards nodes, it must never stop a deployment itself.
 */
export async function checkListFunds(
  task: OutstandingTasksDocument,
  count: number,
  signal?: AbortSignal
): Promise<FundsCheck | null> {
  try {
    const { market, timeout, vault } = task.deployment;
    const markets = (await listMarkets(signal)).filter((listed) =>
      market === null ? listed.type === PREMIUM : listed.address === market
    );
    // A market host-manager does not list is its to answer for (404).
    if (markets.length === 0) return null;

    const key = decryptWithKey(vault.vault_key);
    const timeoutSeconds = timeout * 60;
    return key.startsWith("nos_")
      ? await checkCredits(key, markets, count, timeoutSeconds)
      : await checkVault(vault.vault, markets, count, timeoutSeconds);
  } catch (error) {
    console.warn(`[funds] could not check deployment ${task.deploymentId}, reserving unchecked`, error);
    return null;
  }
}

async function checkCredits(
  apiKey: string,
  markets: HostManagerMarket[],
  count: number,
  timeoutSeconds: number
): Promise<FundsCheck | null> {
  if (markets.some((listed) => listed.type !== PREMIUM)) {
    return { kind: "fatal", error: "Credit-based jobs are only allowed on premium markets" };
  }
  const prices = markets.flatMap((listed) => positive(listed.usd_reward_per_hour));
  if (prices.length === 0) return null;

  const { client_manager_url, network } = getConfig();
  const api = createNosanaApi(network, apiKey, { ...(client_manager_url && { client_manager_url }) });
  const { assignedCredits, reservedCredits, settledCredits } = await api.credits.balance();
  // Counted in client-manager's unit, 0.1 cent, so float dust never costs a job.
  const available = Math.round((assignedCredits - reservedCredits - settledCredits) * 1000);
  const perJob = creditsCost(Math.min(...prices), timeoutSeconds);

  const affordable = Math.min(count, Math.floor(available / perJob));
  if (affordable < 1) {
    return {
      kind: "insufficient",
      error: `Insufficient credits: $${dollars(available)} available, $${dollars(perJob)} needed per job`,
    };
  }
  return {
    kind: "affordable",
    count: affordable,
    budget: { maxUsdPerHour: available / 1000 / affordable / (timeoutSeconds / 3600) },
  };
}

/**
 * Pure: what client-manager charges for one job, in 0.1 cent: USD per hour over
 * the timeout, rounded up, at least 1 cent.
 */
export function creditsCost(usdPerHour: number, timeoutSeconds: number): number {
  return Math.max(Math.ceil(((usdPerHour * timeoutSeconds) / 3600) * 1000), 10);
}

/** Pure: 0.1 cent as dollars for a message. */
function dollars(amount: number): string {
  return (amount / 1000).toFixed(3);
}

async function checkVault(
  vault: string,
  markets: HostManagerMarket[],
  count: number,
  timeoutSeconds: number
): Promise<FundsCheck | null> {
  const prices = markets.flatMap((listed) => positive(listed.nos_reward_per_second));
  if (prices.length === 0) return null;

  const kit = getKit();
  const [nos, sol, ...rents] = await Promise.all([
    kit.nos.getBalance(vault),
    kit.solana.getBalance(vault),
    ...ASSIGN_ACCOUNT_SIZES.map((size) => kit.solana.rpc.getMinimumBalanceForRentExemption(size).send()),
  ]);
  const jobPrice = BigInt(Math.round(Math.min(...prices) * NOS_UNITS));
  const seconds = BigInt(timeoutSeconds);
  const nosPerJob = jobPrice * seconds;
  const solPerJob = rents.reduce((sum, rent) => sum + rent, ASSIGN_FEE_LAMPORTS);

  const affordable = Math.min(count, Number(nos / nosPerJob), Number(sol / solPerJob));
  if (affordable < 1) {
    return {
      kind: "insufficient",
      error:
        `Insufficient funds in vault: ${units(nos, NOS_UNITS)} NOS and ${units(sol, LAMPORTS)} SOL available, ` +
        `${units(nosPerJob, NOS_UNITS)} NOS and ${units(solPerJob, LAMPORTS)} SOL needed per job`,
    };
  }
  return { kind: "affordable", count: affordable, budget: { maxJobPrice: Number(nos / (BigInt(affordable) * seconds)) } };
}

/** Pure: a price as a list of one when it is set and above zero (an unpriced market is skipped). */
function positive(price: number | null): number[] {
  return price !== null && price > 0 ? [price] : [];
}

/** Pure: base units as a decimal amount for a message. */
function units(amount: bigint, perUnit: number): string {
  return (Number(amount) / perUnit).toString();
}
