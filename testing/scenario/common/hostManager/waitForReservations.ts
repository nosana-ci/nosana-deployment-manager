import { expect } from "vitest";

import { hostManagerMock, ReservationCall } from '../../mocks/hostManagerMock.js';

/** Wait until the DM has made at least `count` reservation requests, then inspect them. */
export function waitForReservations({ count }: { count: number }, callback?: (calls: ReservationCall[]) => void) {
  return async () => {
    let calls: ReservationCall[] = [];
    await expect.poll(
      async () => {
        calls = await hostManagerMock.calls();
        return calls.length;
      },
      { message: `Waiting for the DM to have made ${count} reservation request(s)` }
    ).toBeGreaterThanOrEqual(count);

    callback?.(calls);
  };
}
