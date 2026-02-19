import { Type, Static } from "@sinclair/typebox";
import { TaskType } from "../../../../types/index.js";

/**
 * Filter schema for Tasks endpoint
 * Supports filtering by task type and due date ranges
 */
export const TasksFilterSchema = Type.Object({
  task: Type.Optional(
    Type.Union([
      Type.Enum(TaskType),
      Type.String()
    ], {
      description: "Filter by task type. Can be single value or comma-separated list"
    })
  ),
  due_after: Type.Optional(
    Type.String({
      format: "date-time",
      description: "Filter tasks due after this date (ISO 8601 format)"
    })
  ),
  due_before: Type.Optional(
    Type.String({
      format: "date-time",
      description: "Filter tasks due before this date (ISO 8601 format)"
    })
  ),
});

export type TasksFilter = Static<typeof TasksFilterSchema>;
