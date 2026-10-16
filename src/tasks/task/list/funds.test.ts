import { describe, it, expect, vi, beforeEach } from "vitest";

import type { OutstandingTasksDocument } from "../../../types/index.js";

const listMarkets = vi.fn();
const balance = vi.fn();
const createNosanaApi = vi.fn(() => ({ credits: { balance } }));
const nosBalance = vi.fn();
const solBalance = vi.fn();
const rent = vi.fn();
const vaultKey = { value: "solana-secret-key" };

vi.mock("../../../client/hostManager/index.js", () => ({
  listMarkets: (...a: unknown[]) => listMarkets(...a),
}));
vi.mock("@nosana/kit", () => ({
  createNosanaApi: (...a: unknown[]) => createNosanaApi(...a),
}));
vi.mock("../../../kit/index.js", () => ({
  getKit: () => ({
    nos: { getBalance: (...a: unknown[]) => nosBalance(...a) },
    solana: {
      getBalance: (...a: unknown[]) => solBalance(...a),
      rpc: { getMinimumBalanceForRentExemption: (size: bigint) => ({ send: () => rent(size) }) },
    },
  }),
}));
vi.mock("../../../vault/decrypt.js", () => ({ decryptWithKey: () => vaultKey.value }));

import { checkListFunds, creditsCost } from "./funds.js";

const PREMIUM_CHEAP = { address: "cheap", type: "PREMIUM", usd_reward_per_hour: 0.2, nos_reward_per_second: 0.0001 };
const PREMIUM_DEAR = { address: "dear", type: "PREMIUM", usd_reward_per_hour: 1, nos_reward_per_second: 0.0005 };
const COMMUNITY = { address: "community", type: "COMMUNITY", usd_reward_per_hour: null, nos_reward_per_second: 0.00005 };

/** A deployment with a 60 minute timeout. */
function makeTask(market: string | null): OutstandingTasksDocument {
  return {
    deploymentId: "dep-1",
    deployment: { market, timeout: 60, vault: { vault: "Vault111", vault_key: "k" } },
  } as unknown as OutstandingTasksDocument;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  listMarkets.mockResolvedValue([PREMIUM_CHEAP, PREMIUM_DEAR, COMMUNITY]);
  vaultKey.value = "solana-secret-key";
  rent.mockImplementation(async (size: bigint) => (size + 128n) * 6960n);
});

describe("creditsCost", () => {
  it.each([
    [0.2, 3600, 200],
    [0.1745, 7200, 349],
    [0.0001, 60, 10], // at least one cent
    [0.3333, 3600, 334], // rounded up to 0.1 cent
  ])("$%s/h for %ss costs %s tenths of a cent", (usdPerHour, seconds, cost) => {
    expect(creditsCost(usdPerHour, seconds)).toBe(cost);
  });
});

describe("checkListFunds (self-custody vault)", () => {
  // Per job in the cheapest premium market: 100 base units/s × 3600 s = 0.36 NOS,
  // and rent for the job and run accounts plus the fee margin in SOL.
  const NOS_PER_JOB = 360_000n;
  const SOL_PER_JOB = (233n + 128n) * 6960n + (113n + 128n) * 6960n + 100_000n;

  it("caps the count at what the vault can pay in the cheapest market it could get", async () => {
    nosBalance.mockResolvedValue(NOS_PER_JOB * 2n + 5n);
    solBalance.mockResolvedValue(SOL_PER_JOB * 10n);

    expect(await checkListFunds(makeTask(null), 5)).toEqual({
      kind: "affordable",
      count: 2,
      budget: { maxJobPrice: 100 }, // (2 jobs' NOS + 5) / (2 × 3600 s), floored
    });
    expect(nosBalance).toHaveBeenCalledWith("Vault111");
    expect(createNosanaApi).not.toHaveBeenCalled();
  });

  it("SOL for the accounts' rent caps it too", async () => {
    nosBalance.mockResolvedValue(NOS_PER_JOB * 10n);
    solBalance.mockResolvedValue(SOL_PER_JOB);

    expect(await checkListFunds(makeTask(null), 5)).toMatchObject({ kind: "affordable", count: 1 });
  });

  it("is insufficient for an empty vault (the case that held nodes)", async () => {
    nosBalance.mockResolvedValue(0n);
    solBalance.mockResolvedValue(0n);

    expect(await checkListFunds(makeTask(null), 1)).toEqual({
      kind: "insufficient",
      error:
        "Insufficient funds in vault: 0 NOS and 0 SOL available, 0.36 NOS and 0.00428992 SOL needed per job",
    });
  });

  it("prices a deployment with a market by that market only", async () => {
    nosBalance.mockResolvedValue(NOS_PER_JOB * 3n);
    solBalance.mockResolvedValue(SOL_PER_JOB * 10n);

    // The dear market costs five times as much: three cheap jobs' NOS buys none.
    expect(await checkListFunds(makeTask("dear"), 1)).toMatchObject({ kind: "insufficient" });
  });

  it("lets a self-custody vault use a community market", async () => {
    nosBalance.mockResolvedValue(NOS_PER_JOB);
    solBalance.mockResolvedValue(SOL_PER_JOB);

    expect(await checkListFunds(makeTask("community"), 1)).toMatchObject({ kind: "affordable", count: 1 });
  });
});

describe("checkListFunds (API-key vault, credits)", () => {
  beforeEach(() => {
    vaultKey.value = "nos_api_key";
  });

  it("caps the count at the credits available and reads them with the vault's key", async () => {
    balance.mockResolvedValue({ assignedCredits: 10, reservedCredits: 2, settledCredits: 7.4 });

    expect(await checkListFunds(makeTask(null), 5)).toEqual({
      kind: "affordable",
      count: 3, // $0.60 (0.5999… in floats) at $0.20 a job
      budget: { maxUsdPerHour: expect.closeTo(0.2, 9) },
    });
    expect(createNosanaApi).toHaveBeenCalledWith(expect.anything(), "nos_api_key", expect.anything());
    expect(nosBalance).not.toHaveBeenCalled();
  });

  it("is insufficient without credits for one job, worded so it can never read as a ban", async () => {
    balance.mockResolvedValue({ assignedCredits: 1, reservedCredits: 0.5, settledCredits: 0.426 });

    expect(await checkListFunds(makeTask(null), 1)).toEqual({
      kind: "insufficient",
      error: "Insufficient credits: $0.074 available, $0.200 needed per job",
    });
  });

  it("is fatal on a non-premium market: credits never pay there", async () => {
    expect(await checkListFunds(makeTask("community"), 1)).toEqual({
      kind: "fatal",
      error: "Credit-based jobs are only allowed on premium markets",
    });
    expect(balance).not.toHaveBeenCalled();
  });
});

describe("checkListFunds fails open", () => {
  it.each([
    ["host-manager is down", () => listMarkets.mockRejectedValue(new Error("fetch failed"))],
    ["the chain read fails", () => nosBalance.mockRejectedValue(new Error("rpc down"))],
  ])("when %s", async (_case, arrange) => {
    arrange();
    solBalance.mockResolvedValue(0n);

    expect(await checkListFunds(makeTask(null), 1)).toBeNull();
  });

  it("for a market host-manager does not list (it answers 404 itself)", async () => {
    expect(await checkListFunds(makeTask("unknown"), 1)).toBeNull();
  });

  it("for markets without a price", async () => {
    listMarkets.mockResolvedValue([{ ...PREMIUM_CHEAP, usd_reward_per_hour: null, nos_reward_per_second: 0 }]);

    expect(await checkListFunds(makeTask(null), 1)).toBeNull();
  });

  it("when client-manager cannot answer the balance", async () => {
    vaultKey.value = "nos_api_key";
    balance.mockRejectedValue(new Error("502"));

    expect(await checkListFunds(makeTask(null), 1)).toBeNull();
  });
});
