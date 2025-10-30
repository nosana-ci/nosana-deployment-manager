import { FastifySchema } from "fastify";
import { Type, Static } from "@sinclair/typebox";

import { PublicKeySchema, type ErrorSchema } from "../../../../../index.schema.js";

const DeploymentJobByIdResponse = Type.Object({
  confidential: Type.Boolean(),
  revision: Type.Number({ minimum: 1 }),
  market: PublicKeySchema,
  node: PublicKeySchema,
  state: Type.Union([Type.String(), Type.Number()]),
  jobStatus: Type.Union([Type.String(), Type.Null()]),
  jobDefinition: Type.Ref("JobDefinition"),
  jobResult: Type.Union([Type.Ref("JobResults"), Type.Null()]),
  timeStart: Type.Number({ minimum: 0 }),
  timeEnd: Type.Number({ minimum: 0 }),
  listedAt: Type.Number({ minimum: 0 }),
});

export type DeploymentJobByIdSuccess = Static<typeof DeploymentJobByIdResponse>;
export type DeploymentJobByIdError = ErrorSchema;

export const DeploymentJobByIdSchema: FastifySchema = {
  description: "Get a specific deployment job by ID.",
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
      job: {
        $ref: "PublicKey",
      },
    },
    required: ["deployment", "job"],
  },
  response: {
    200: {
      description: "Gets a deployment job by ID.",
      content: {
        "application/json": {
          schema: DeploymentJobByIdResponse,
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
