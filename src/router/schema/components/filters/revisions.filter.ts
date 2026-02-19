import { Type, Static } from "@sinclair/typebox";

/**
 * Filter schema for Revisions endpoint
 * Supports filtering by revision number and date ranges
 */
export const RevisionsFilterSchema = Type.Object({
  revision: Type.Optional(
    Type.Number({
      minimum: 0,
      description: "Filter by exact revision number"
    })
  ),
  created_after: Type.Optional(
    Type.String({
      format: "date-time",
      description: "Filter revisions created after this date (ISO 8601 format)"
    })
  ),
  created_before: Type.Optional(
    Type.String({
      format: "date-time",
      description: "Filter revisions created before this date (ISO 8601 format)"
    })
  ),
});

export type RevisionsFilter = Static<typeof RevisionsFilterSchema>;
