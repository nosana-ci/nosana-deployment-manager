import { JobState } from "../../../types/index.js";

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

const JOB_STATE_NUMBER: Record<JobState, number> = {
  [JobState.QUEUED]: 0,
  [JobState.RUNNING]: 1,
  [JobState.COMPLETED]: 2,
  [JobState.STOPPED]: 3,
};

export function jobStateToNumber(state: JobState): number {
  return JOB_STATE_NUMBER[state];
}
