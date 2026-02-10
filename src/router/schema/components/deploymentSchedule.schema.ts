import { Type } from "@sinclair/typebox";

export const DeploymentScheduleSchema = Type.String({
  description: "Cron expression for scheduled deployments",
  pattern: "^\\s*(\\S+)\\s+(\\S+)\\s+(\\S+)\\s+(\\S+)\\s+(\\S+)\\s*$",
});
