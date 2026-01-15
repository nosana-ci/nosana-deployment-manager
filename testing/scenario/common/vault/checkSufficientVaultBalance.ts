import { expect } from 'vitest';
import type { Deployment } from '@nosana/api';

import { min_balance } from '../../setup.js';
import { State } from '../../utils/index.js';

export function checkSufficientVaultBalance(
  state: State<Deployment>,
  minBalance = min_balance
) {
  return async () => {
    const balance = await state.get().vault.getBalance();
    expect(balance.SOL).toBeGreaterThanOrEqual(minBalance.SOL);
    expect(balance.NOS).toBeGreaterThanOrEqual(minBalance.NOS);
  };
}