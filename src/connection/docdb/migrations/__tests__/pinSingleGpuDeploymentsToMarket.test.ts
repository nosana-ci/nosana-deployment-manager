import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";

import pinSingleGpuDeploymentsToMarket, { singleGpuOf } from "../20-pinSingleGpuDeploymentsToMarket.js";

const listGpus = vi.hoisted(() => vi.fn());
vi.mock("@nosana/kit", () => ({ createNosanaApi: () => ({ reservations: { listGpus } }) }));
vi.mock("../../../../config/index.js", () => ({
  getConfig: () => ({ network: "mainnet", host_manager_url: "http://host-manager" }),
}));

const RTX_4090 = "NVIDIA GeForce RTX 4090";
const RTX_4060 = "NVIDIA GeForce RTX 4060";
const MARKET_4090 = "97G9NnvBDQ2WpKu6fasoMsAKmfj63C9rhysJnkeWodAf";
const MARKET_4060 = "47LQHZwT7gfVoBDYnRYhsYv6vKk8a1oW3Y3SdHAp1gTr";
const MARKET_3090 = "CA5pMpqkYFKtme7K31pNB1s62X2SdhEv1nN9RdxKCpuQ";

const find = vi.fn();
const bulkWrite = vi.fn();
let rows: unknown[] = [];
const db = {
  collection: () => ({
    find: (...args: unknown[]) => {
      find(...args);
      return { toArray: async () => rows };
    },
    bulkWrite,
  }),
} as unknown as Db;

const catalogue = {
  gpus: [
    { name: RTX_4090, markets: [MARKET_4090] },
    // A model reported with two VRAM sizes, one of them also seen in another market.
    { name: RTX_4060, markets: [MARKET_4060] },
    { name: RTX_4060, markets: [MARKET_4060, MARKET_3090] },
  ],
};

const pinned = () =>
  (bulkWrite.mock.calls[0]?.[0] ?? []).map(
    (write: { updateOne: { filter: unknown; update: unknown } }) => write.updateOne
  );

describe("pinSingleGpuDeploymentsToMarket", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listGpus.mockResolvedValue(catalogue);
    rows = [];
  });

  it("looks only at unpinned deployments that name a GPU", async () => {
    await pinSingleGpuDeploymentsToMarket(db);

    expect(find).toHaveBeenCalledWith(
      { market: null, "requirements.name": { $exists: true } },
      { projection: { id: 1, requirements: 1 } }
    );
  });

  it("does not ask for the catalogue, or write, when there is nothing to pin", async () => {
    await pinSingleGpuDeploymentsToMarket(db);

    expect(listGpus).not.toHaveBeenCalled();
    expect(bulkWrite).not.toHaveBeenCalled();
  });

  it("pins a single GPU, given as a value or a list of one, to the market the catalogue lists it in", async () => {
    rows = [
      { id: "dep-1", requirements: { name: RTX_4090 } },
      { id: "dep-2", requirements: { name: [RTX_4090], ram_gb: 64 } },
    ];

    await pinSingleGpuDeploymentsToMarket(db);

    expect(pinned()).toEqual([
      { filter: { id: "dep-1", market: null }, update: { $set: { market: MARKET_4090 } } },
      { filter: { id: "dep-2", market: null }, update: { $set: { market: MARKET_4090 } } },
    ]);
  });

  it("takes the first market across a model's catalogue rows, as the dashboard does", async () => {
    rows = [{ id: "dep-1", requirements: { name: RTX_4060 } }];

    await pinSingleGpuDeploymentsToMarket(db);

    expect(pinned()).toEqual([{ filter: { id: "dep-1", market: null }, update: { $set: { market: MARKET_4060 } } }]);
  });

  it("leaves a deployment naming several GPUs to keep reserving", async () => {
    rows = [{ id: "dep-1", requirements: { name: [RTX_4090, RTX_4060] } }];

    await pinSingleGpuDeploymentsToMarket(db);

    expect(bulkWrite).not.toHaveBeenCalled();
  });

  it("leaves a deployment whose GPU no host has now, and says which", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    rows = [{ id: "dep-1", requirements: { name: "NVIDIA H200" } }];

    await pinSingleGpuDeploymentsToMarket(db);

    expect(bulkWrite).not.toHaveBeenCalled();
    expect(log.mock.calls[0][0]).toContain("dep-1 (NVIDIA H200)");
    log.mockRestore();
  });

  it("changes nothing but the market: no updated_at, requirements kept", async () => {
    rows = [{ id: "dep-1", requirements: { name: RTX_4090, country: "NL" } }];

    await pinSingleGpuDeploymentsToMarket(db);

    expect(JSON.stringify(bulkWrite.mock.calls[0][0])).not.toContain("updated_at");
    expect(JSON.stringify(bulkWrite.mock.calls[0][0])).not.toContain("requirements");
  });
});

describe("singleGpuOf", () => {
  it("reads one GPU from a value or a one-item list", () => {
    expect(singleGpuOf({ name: RTX_4090 })).toBe(RTX_4090);
    expect(singleGpuOf({ name: [RTX_4090] })).toBe(RTX_4090);
  });

  it("is null for none, several, or a non-text name", () => {
    expect(singleGpuOf(null)).toBeNull();
    expect(singleGpuOf({ ram_gb: 64 })).toBeNull();
    expect(singleGpuOf({ name: [RTX_4090, RTX_4060] })).toBeNull();
    expect(singleGpuOf({ name: [] })).toBeNull();
    expect(singleGpuOf({ name: 4090 })).toBeNull();
  });
});
