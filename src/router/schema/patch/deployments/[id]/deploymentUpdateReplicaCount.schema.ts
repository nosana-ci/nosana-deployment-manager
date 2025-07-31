import { FastifySchema } from "fastify";
import { Static, Type } from "@sinclair/typebox";

import { ErrorSchema } from "../../../index.schema.js";

const DeploymentUpdateReplicaCountSuccess = Type.Object({
  replicas: Type.Number({ minimum: 1 }),
  updated_at: Type.String({ format: "date-time" }),
});
export type DeploymentUpdateReplicaCountSuccess = Static<
  typeof DeploymentUpdateReplicaCountSuccess
>;
export type DeploymentUpdateReplicaCountError = ErrorSchema;

export const DeploymentUpdateReplicaCountSchema: FastifySchema = {
  description: "Update the replica count of a deployment",
  tags: ["Deployments"],
  headers: {
    $ref: "Headers",
  },
  params: {
    type: "object",
    properties: {
      deployment: {
        $ref: "PublicKey",
      },
    },
    required: ["deployment"],
  },
  body: Type.Object({
    replicas: Type.Number({ minimum: 1 }),
  }),
  response: {
    200: {
      description: "Deployment replica count updated successfully.",
      content: {
        "application/json": {
          schema: DeploymentUpdateReplicaCountSuccess,
        },
      },
    },
    401: {
      description: "Unauthorized. Invalid or missing authentication.",
      content: {
        "application/json": {
          schema: Type.Literal("Unauthorized"),
        },
      },
    },
    404: {
      description: "Deployment not found.",
      content: {
        "application/json": {
          schema: {
            $ref: "Error",
          },
        },
      },
    },
    500: {
      description: "Internal Server Error.",
      content: {
        "application/json": {
          schema: {
            $ref: "Error",
          },
        },
      },
    },
  },
};
