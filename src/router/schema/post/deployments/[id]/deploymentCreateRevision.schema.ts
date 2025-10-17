import { Static, Type } from "@sinclair/typebox";
import { FastifySchema } from "fastify";

import { ErrorSchema } from "../../../index.schema.js";
import { EndpointSchema } from "../../../components/endpoint.schema.js";
import { RevisionSchema } from "../../../components/revision.schema.js";

export const DeploymentCreateRevisionSuccess = Type.Object({
  active_revision: Type.Integer({ minimum: 1 }),
  endpoints: Type.Array(EndpointSchema),
  revisions: Type.Array(RevisionSchema),
  updated_at: Type.String({ format: "date-time" }),
});

export type DeploymentCreateRevisionSuccess = Static<typeof DeploymentCreateRevisionSuccess>;
export type DeploymentCreateRevisionError = ErrorSchema;

export const DeploymentCreateRevisionSchema: FastifySchema = {
  description: "Create a new deployment revision.",
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
  body: {
    $ref: "JobDefinition",
  },
  response: {
    200: {
      description: "Deployment CreateRevisioned successfully.",
      content: {
        "application/json": {
          schema: DeploymentCreateRevisionSuccess,
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
  security: [
    {
      Authorization: [],
    },
  ],
};
