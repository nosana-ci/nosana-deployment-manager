import { Static, Type } from "@sinclair/typebox";

export const RequirementsSchema = Type.Record(
  Type.String({ pattern: "^.{1,256}$" }),
  Type.Union([Type.Number(), Type.String(), Type.Boolean()]),
  {
    minProperties: 1,
    additionalProperties: false,
    description:
      "Node requirements as a map of metric key to value: a number is a minimum, a string or boolean an exact match. Keys are validated by the host manager when nodes are reserved.",
  }
);

export type DeploymentRequirements = Static<typeof RequirementsSchema>;
