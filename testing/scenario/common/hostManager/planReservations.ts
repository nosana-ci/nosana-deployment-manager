import { hostManagerMock, ReservationPlanEntry } from '../../mocks/hostManagerMock.js';

/** Script what the next reservation requests get back from the (mocked) host-manager. */
export function planReservations(responses: ReservationPlanEntry[]) {
  return async () => {
    await hostManagerMock.plan(responses);
  };
}
