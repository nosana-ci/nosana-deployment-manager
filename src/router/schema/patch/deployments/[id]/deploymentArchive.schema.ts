import { FastifySchema } from "fastify";
import { Static, Type } from "@sinclair/typebox";

import { ErrorSchema } from "../../../index.schema.js";
import { DeploymentStatus } from "../../../../../types/index.js";

const DeploymentArchiveSuccess = Type.Object({
  status: Type.Literal(DeploymentStatus.ARCHIVED),
  updated_at: Type.String({ format: "date-time" }),
});

export type DeploymentArchiveSuccess = Static<typeof DeploymentArchiveSuccess>;
export type DeploymentArchiveError = ErrorSchema;

export const DeploymentArchiveSchema: FastifySchema = {
  description: "Archive a deployment",
  tags: ["deployments"],
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
  response: {
    200: {
      description: "Deployment archived successfully.",
      content: {
        "application/json": {
          schema: DeploymentArchiveSuccess,
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
