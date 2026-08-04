import { getConfig } from "../../../config/index.js";

import type { JobsDocument } from "../../../types/index.js";

export function allJobsRapid(jobs: JobsDocument[]): boolean {
  const { rapid_completion_job_count, rapid_completion_threshold_minutes } = getConfig();
  const thresholdMs = rapid_completion_threshold_minutes * 60_000;

  if (jobs.length < rapid_completion_job_count) return false;

  return jobs.every((job) => {
    // Run time must come from the on-chain start/end stamps: `updated_at` is a
    // doc-write time (historically frozen at the list-confirm), so it measured
    // every job as ~0s and tripped the fail-safe on healthy deployments. A job
    // missing either stamp (legacy doc, never started, not yet synced) counts
    // as NOT rapid so the fail-safe errs toward keeping deployments alive.
    if (!job.time_start || !job.time_end) return false;
    return (job.time_end - job.time_start) * 1000 < thresholdMs;
  });
}
