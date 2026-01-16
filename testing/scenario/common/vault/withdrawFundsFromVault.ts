import { expect } from "vitest";

import { vault } from "../../setup.js"

export function withdrawFundsFromVault() {
  return async () => {
    await vault.withdraw();
    const balance = await vault.getBalance();
    expect(balance).toEqual({
      SOL: 0,
      NOS: 0
    });
  }
}