import type { Collection } from "mongodb";
import type { FlowState } from "@nosana/kit";

import type { JobResultsSchema } from "../router/schema/index.schema.js";

export const JobState = {
  QUEUED: "QUEUED",
  RUNNING: "RUNNING",
  COMPLETED: "COMPLETED",
  STOPPED: "STOPPED",
} as const;

export type JobState = (typeof JobState)[keyof typeof JobState];

/** The states a job can still be found in on chain; everything else is history. */
export const ACTIVE_JOB_STATES = [JobState.QUEUED, JobState.RUNNING] as const;

export const JobsDocumentFields: Record<Uppercase<keyof JobsDocument>, keyof JobsDocument> = {
  JOB: "job",
  MARKET: "market",
  DEPLOYMENT: "deployment",
  NODE: "node",
  REVISION: "revision",
  TX: "tx",
  STATE: "state",
  TIME_START: "time_start",
  TIME_END: "time_end",
  CREATED_AT: "created_at",
  UPDATED_AT: "updated_at",
};

export type JobsDocument = {
  job: string;
  market: string;
  node: string | null;
  deployment: string;
  revision: number;
  tx: string;
  state: JobState;
  time_start: number;
  /**
   * On-chain end timestamp (unix seconds), written when the finisher paths see
   * the job leave RUNNING. Absent on docs from before the field existed and on
   * jobs that have not finished.
   */
  time_end?: number;
  created_at: Date;
  updated_at: Date;
};

export type JobsCollection = Collection<JobsDocument>;

export type JobResultsDocument = {
  job: string;
  results: JobResultsSchema;
};

export type JobResultsCollection = Collection<JobResultsDocument>;

export type ResultsDocument = {
  job: string;
  results: FlowState;
};

export type ResultsCollection = Collection<ResultsDocument>;
