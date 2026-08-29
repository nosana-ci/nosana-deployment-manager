import { FastifySchema } from "fastify";
import { Static, Type } from "@sinclair/typebox";
import { ErrorSchema } from "../../../index.schema";

const DeploymentUpdateStartupTimeoutSuccess = Type.Object({
  startup_timeout: Type.Number(),
  updated_at: Type.String(),
});

export type DeploymentUpdateStartupTimeoutSuccess = Static<
  typeof DeploymentUpdateStartupTimeoutSuccess
>;
export type DeploymentUpdateStartupTimeoutError = ErrorSchema;

export const DeploymentUpdateStartupTimeoutSchema: FastifySchema = {
  description: "Update the startup timeout of an INFINITE deployment.",
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
    startup_timeout: Type.Number({
      minimum: 1,
      description:
        "Minutes a job has, from the moment a node starts running it, to open its network tunnel. A job that does not come online in time is stopped and replaced on another node. The new value applies to jobs started after the update. INFINITE deployments only, and the job definition must expose at least one port.",
    }),
  }),
  response: {
    200: {
      description: "Deployment startup timeout updated successfully.",
      content: {
        "application/json": {
          schema: DeploymentUpdateStartupTimeoutSuccess,
        },
      },
    },
    400: {
      description:
        "Bad Request. The deployment is not INFINITE, or its job definition exposes no ports.",
      content: {
        "application/json": {
          schema: {
            $ref: "Error",
          },
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
