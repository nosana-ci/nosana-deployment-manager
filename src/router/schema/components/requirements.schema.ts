import { Static, Type } from "@sinclair/typebox";

const RequirementValueSchema = Type.Union([Type.Number(), Type.String(), Type.Boolean()]);

export const RequirementsSchema = Type.Record(
  Type.String({ pattern: "^.{1,256}$" }),
  Type.Union([RequirementValueSchema, Type.Array(RequirementValueSchema, { minItems: 1 })]),
  {
    minProperties: 1,
    additionalProperties: false,
    description:
      'Node requirements as a map of metric key to value: a number is a minimum, a string or boolean an exact match, and a list is any of its values (e.g. `"name": ["NVIDIA GeForce RTX 4090", "NVIDIA GeForce RTX 5090"]`). Keys are validated by the host manager when nodes are reserved.',
  }
);

export type DeploymentRequirements = Static<typeof RequirementsSchema>;
