import { expect } from "vitest";

import { min_balance, vault } from "../../setup.js"

export function topupVault() {
  return async () => {
    await vault.topup(min_balance);
    const balance = await vault.getBalance();
    expect(balance).toEqual(min_balance);
  }
}