import { JobState, type JobsDocument } from "../../../types/index.js";

type SelectJobsToStopOptions = {
  /** Maximum number of jobs to stop. When omitted, every eligible job is selected. */
  limit?: number;
  /** Jobs belonging to this revision are kept (they are the desired, current jobs). */
  activeRevision?: number;
};

/**
 * Chooses which jobs to stop, in priority order, when trimming a deployment.
 *
 * Ordering: QUEUED jobs are stopped before RUNNING jobs (cancelling work that
 * has not started yet is preferred over terminating in-progress work), and
 * within each group the oldest (by `updated_at`) are stopped first. Jobs on the
 * active revision are never selected.
 */
export function selectJobsToStop(
  jobs: JobsDocument[],
  { limit, activeRevision }: SelectJobsToStopOptions,
): JobsDocument[] {
  const stateRank = (state: JobState) => (state === JobState.QUEUED ? 0 : 1);

  return jobs
    .filter(({ revision }) => !(activeRevision && activeRevision === revision))
    .sort((a, b) => {
      const byState = stateRank(a.state) - stateRank(b.state);
      if (byState !== 0) return byState;
      return a.updated_at.getTime() - b.updated_at.getTime();
    })
    .slice(0, limit || jobs.length);
}
