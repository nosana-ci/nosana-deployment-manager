import { Type, Static } from "@sinclair/typebox";
import { EventType } from "../../../../types/index.js";

/**
 * Filter schema for Events endpoint
 * Supports filtering by category, event type, and date ranges
 */
export const EventsFilterSchema = Type.Object({
  category: Type.Optional(
    Type.Union([
      Type.Enum(EventType),
      Type.String()
    ], {
      description: "Filter by event category: 'Deployment' or 'Event'. Can be comma-separated list"
    })
  ),
  type: Type.Optional(
    Type.String({
      description: "Filter by event type. Can be single value or comma-separated list"
    })
  ),
  created_after: Type.Optional(
    Type.String({
      format: "date-time",
      description: "Filter events created after this date (ISO 8601 format)"
    })
  ),
  created_before: Type.Optional(
    Type.String({
      format: "date-time",
      description: "Filter events created before this date (ISO 8601 format)"
    })
  ),
});

export type EventsFilter = Static<typeof EventsFilterSchema>;
