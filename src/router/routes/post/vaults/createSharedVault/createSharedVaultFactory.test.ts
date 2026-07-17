import { describe, it, expect, vi, beforeEach } from "vitest";

import type { VaultDocument } from "../../../../../types/index.js";

const generateVault = vi.fn();
const findOne = vi.fn();
const updateOne = vi.fn();

vi.mock("../../../../../vault/generate.js", () => ({
  generateVault: (...a: unknown[]) => generateVault(...a),
}));
vi.mock("../../../../../repositories/index.js", () => ({
  getRepository: () => ({
    findOne: (...a: unknown[]) => findOne(...a),
    collection: { updateOne: (...a: unknown[]) => updateOne(...a) },
  }),
}));

import { getOrCreateVault, VaultNotFoundError } from "./createSharedVaultFactory.js";

describe("getOrCreateVault", () => {
  beforeEach(() => {
    generateVault.mockReset();
    findOne.mockReset();
    updateOne.mockReset();
    updateOne.mockResolvedValue({ acknowledged: true, upsertedCount: 1, matchedCount: 0 });
  });

  describe("targetVault (explicit existing vault)", () => {
    it("returns the vault when owned by the caller", async () => {
      const created_at = new Date("2026-01-01T00:00:00.000Z");
      findOne.mockResolvedValue({
        vault: "target-vault",
        vault_key: "enc",
        owner: "owner-1",
        created_at,
      } as VaultDocument);

      const result = await getOrCreateVault({ owner: "owner-1", targetVault: "target-vault" });

      expect(findOne).toHaveBeenCalledWith({ owner: "owner-1", vault: "target-vault" });
      expect(generateVault).not.toHaveBeenCalled();
      expect(result).toEqual({
        vault: "target-vault",
        owner: "owner-1",
        created_at: created_at.toISOString(),
      });
    });

    it("throws VaultNotFoundError when the vault is unknown or unowned", async () => {
      findOne.mockResolvedValue(null);

      await expect(
        getOrCreateVault({ owner: "owner-1", targetVault: "not-mine" }),
      ).rejects.toBeInstanceOf(VaultNotFoundError);
      expect(generateVault).not.toHaveBeenCalled();
    });

    it("rejects the owner's API-key vault doc (targetVault === owner) without a lookup", async () => {
      await expect(
        getOrCreateVault({ owner: "owner-1", targetVault: "owner-1" }),
      ).rejects.toBeInstanceOf(VaultNotFoundError);
      expect(findOne).not.toHaveBeenCalled();
    });
  });

  describe("default (shared vault)", () => {
    it("returns the owner's oldest vault, excluding API-key docs", async () => {
      const created_at = new Date("2025-06-01T00:00:00.000Z");
      findOne.mockResolvedValue({
        vault: "oldest-vault",
        vault_key: "enc",
        owner: "owner-2",
        created_at,
      } as VaultDocument);

      const result = await getOrCreateVault({ owner: "owner-2" });

      // Oldest-first and deterministic on created_at ties; API-key vault docs
      // (vault === owner) are excluded.
      expect(findOne).toHaveBeenCalledWith(
        { owner: "owner-2", vault: { $ne: "owner-2" } },
        { sort: { created_at: 1, vault: 1 } },
      );
      expect(generateVault).not.toHaveBeenCalled();
      expect(result.vault).toBe("oldest-vault");
    });

    it("creates a vault when the owner has none", async () => {
      findOne.mockResolvedValue(null);
      generateVault.mockResolvedValue(["new-pubkey", "new-enckey"]);

      const result = await getOrCreateVault({ owner: "owner-3" });

      expect(generateVault).toHaveBeenCalledOnce();
      expect(updateOne).toHaveBeenCalledWith(
        { vault: "new-pubkey" },
        { $setOnInsert: expect.objectContaining({ vault: "new-pubkey", owner: "owner-3" }) },
        { upsert: true },
      );
      expect(result.vault).toBe("new-pubkey");
    });
  });

  describe("createNew (explicit new vault)", () => {
    it("mints a fresh vault without looking up existing ones", async () => {
      generateVault.mockResolvedValue(["fresh-pubkey", "fresh-enckey"]);

      const result = await getOrCreateVault({ owner: "owner-4", createNew: true });

      expect(findOne).not.toHaveBeenCalled();
      expect(result.vault).toBe("fresh-pubkey");
    });
  });

  it("throws when persisting the new vault fails", async () => {
    findOne.mockResolvedValue(null);
    generateVault.mockResolvedValue(["pubkey", "enckey"]);
    updateOne.mockResolvedValue({ acknowledged: false, upsertedCount: 0, matchedCount: 0 });

    await expect(getOrCreateVault({ owner: "owner-5" })).rejects.toThrow("Failed to create vault.");
  });
});
