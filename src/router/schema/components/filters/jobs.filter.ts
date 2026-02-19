import { Type, Static } from "@sinclair/typebox";
import { JobState } from "../../../../types/index.js";

/**
 * Filter schema for Jobs endpoint
 * Supports filtering by state, job ID, revision, and date ranges
 */
export const JobsFilterSchema = Type.Object({
  state: Type.Optional(
    Type.Union([
      Type.Enum(JobState),
      Type.String()
    ], {
      description: "Filter by job state. Can be single value or comma-separated list (e.g., 'RUNNING,COMPLETED')"
    })
  ),
  job: Type.Optional(
    Type.String({
      description: "Filter by exact job ID"
    })
  ),
  revision: Type.Optional(
    Type.Number({
      minimum: 0,
      description: "Filter by deployment revision number"
    })
  ),
  created_after: Type.Optional(
    Type.String({
      format: "date-time",
      description: "Filter jobs created after this date (ISO 8601 format)"
    })
  ),
  created_before: Type.Optional(
    Type.String({
      format: "date-time",
      description: "Filter jobs created before this date (ISO 8601 format)"
    })
  ),
});

export type JobsFilter = Static<typeof JobsFilterSchema>;
