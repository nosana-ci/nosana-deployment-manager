import { expect } from "vitest";

import { min_balance, vault } from "../../setup.js"

/**
 * Top the shared test vault up by `amount` (default `min_balance`). Asserts the
 * balance is at least `amount` afterwards (>= rather than ==, so it is safe to
 * call when the vault already holds funds — e.g. to guarantee a later flow has
 * enough to post a job after an earlier flow drained the shared vault).
 */
export function topupVault(amount = min_balance) {
  return async () => {
    await vault.topup(amount);
    const balance = await vault.getBalance();
    expect(balance.SOL).toBeGreaterThanOrEqual(amount.SOL);
    expect(balance.NOS).toBeGreaterThanOrEqual(amount.NOS);
  }
}
