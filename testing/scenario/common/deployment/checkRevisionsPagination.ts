import { expect } from 'vitest';
import type { Deployment } from '@nosana/api';

import { State } from '../../utils/index.js';

export function checkRevisionsPagination(state: State<Deployment>, expectedCount: number) {
  return async () => {
    const deployment = state.get();
    const response = await deployment.getRevisions();
    expect(response.revisions.length).toBe(expectedCount);
    expect(response.total_items).toBe(expectedCount);
  };
}
