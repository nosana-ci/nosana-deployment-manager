import type { TxRecord } from "../../../types/index.js";

/**
 * Job addresses carried by a unit, tolerating the pre-bulking single-job shape
 * so a record persisted by an older replica still resolves across a rolling
 * deploy. A bulked LIST unit carries N; STOP/EXTEND carry one.
 */
export function recordJobs(record: TxRecord): string[] {
  return record.jobs ?? (record.job != null ? [record.job] : []);
}

/** Run addresses carried by a unit, index-aligned with {@link recordJobs}. */
export function recordRuns(record: TxRecord): string[] {
  return record.runs ?? (record.run != null ? [record.run] : []);
}
