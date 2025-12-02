import { JobState } from "../../types/index.js";

export function convertJobState(state: number): JobState {
  switch (state) {
    case 0:
      return JobState.QUEUED;
    case 1:
      return JobState.RUNNING;
    case 2:
      return JobState.COMPLETED;
    case 3:
      return JobState.STOPPED;
    default:
      throw new Error(`Unknown job state: ${state}`);
  }
}
