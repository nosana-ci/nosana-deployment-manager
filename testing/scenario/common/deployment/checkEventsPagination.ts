import { expect } from 'vitest';
import type { Deployment } from '@nosana/api';

import { State } from '../../utils/index.js';

export function checkEventsPagination(state: State<Deployment>, expectedCount: number) {
  return async () => {
    const deployment = state.get();
    const response = await deployment.getEvents();
    expect(response.events.length).toBe(expectedCount);
    expect(response.total_items).toBe(expectedCount);
  };
}
