import { Type, Static } from "@sinclair/typebox";
import { DeploymentStatus, DeploymentStrategy } from "../../../../types/index.js";

/**
 * Filter schema for Deployments endpoint
 * Supports filtering by status, strategy, vault, ID, and date ranges
 */
export const DeploymentsFilterSchema = Type.Object({
  status: Type.Optional(
    Type.Union([
      Type.Enum(DeploymentStatus),
      Type.String()
    ], {
      description: "Filter by deployment status. Can be single value or comma-separated list"
    })
  ),
  strategy: Type.Optional(
    Type.Union([
      Type.Enum(DeploymentStrategy),
      Type.String()
    ], {
      description: "Filter by deployment strategy. Can be single value or comma-separated list"
    })
  ),
  id: Type.Optional(
    Type.String({
      description: "Filter by exact deployment ID"
    })
  ),
  vault: Type.Optional(
    Type.String({
      description: "Filter by vault public key"
    })
  ),
  created_after: Type.Optional(
    Type.String({
      format: "date-time",
      description: "Filter deployments created after this date (ISO 8601 format)"
    })
  ),
  created_before: Type.Optional(
    Type.String({
      format: "date-time",
      description: "Filter deployments created before this date (ISO 8601 format)"
    })
  ),
});

export type DeploymentsFilter = Static<typeof DeploymentsFilterSchema>;
