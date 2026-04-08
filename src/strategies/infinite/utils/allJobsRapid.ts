import { getConfig } from "../../../config/index.js";

import type { JobsDocument } from "../../../types/index.js";

export function allJobsRapid(jobs: JobsDocument[]): boolean {
  const { rapid_completion_job_count, rapid_completion_threshold_minutes } = getConfig();
  const thresholdMs = rapid_completion_threshold_minutes * 60_000;

  if (jobs.length >= rapid_completion_job_count) {
    const allRapid = jobs.every((job) => {
      const duration = job.updated_at.getTime() - job.time_start;
      return duration < thresholdMs;
    });
    return allRapid;
  }
  return false;
}