import { JobState, type JobsDocument } from "../../../types/index.js";

type SelectJobsToStopOptions = {
  /** Maximum number of jobs to stop. When omitted, every eligible job is selected. */
  limit?: number;
  /** Jobs belonging to this revision are kept (they are the desired, current jobs). */
  activeRevision?: number;
  /**
   * Stop exactly this job and no other. Set by the schedulers that target one
   * replica — an unreachable tunnel, a missed startup deadline — where the task
   * carries no `limit` and the deployment's other replicas are healthy.
   * Selects nothing when the job is no longer active (it settled on its own
   * between scheduling and running), which the caller handles as a no-op stop.
   */
  job?: string;
};

/**
 * Chooses which jobs to stop, in priority order, when trimming a deployment.
 *
 * A `job` targets one specific replica and short-circuits everything below —
 * `jobs` is the deployment's whole active set, so without this filter a targeted
 * stop with no `limit` would freeze every replica into its stop-set and tear the
 * deployment down. Priority ordering is meaningless for a set of one, and the
 * active-revision guard does not apply: the caller has already decided THIS job
 * must go, current revision or not.
 *
 * Otherwise, ordering: QUEUED jobs are stopped before RUNNING jobs (cancelling
 * work that has not started yet is preferred over terminating in-progress work),
 * and within each group the oldest (by `updated_at`) are stopped first. Jobs on
 * the active revision are never selected.
 */
export function selectJobsToStop(
  jobs: JobsDocument[],
  { limit, activeRevision, job: target }: SelectJobsToStopOptions,
): JobsDocument[] {
  if (target) return jobs.filter(({ job }) => job === target);

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
