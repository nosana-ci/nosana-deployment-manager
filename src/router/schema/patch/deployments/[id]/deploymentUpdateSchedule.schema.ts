import { FastifySchema } from "fastify";
import { Static, Type } from "@sinclair/typebox";

import { ErrorSchema } from "../../../index.schema.js";
import { DeploymentScheduleSchema } from "../../../components/deploymentSchedule.schema.js";

const DeploymentUpdateScheduleSuccess = Type.Object({
  schedule: DeploymentScheduleSchema,
  updated_at: Type.String(),
});

export type DeploymentUpdateScheduleSuccess = Static<
  typeof DeploymentUpdateScheduleSuccess
>;
export type DeploymentUpdateScheduleError = ErrorSchema;

export const DeploymentUpdateScheduleSchema: FastifySchema = {
  description: "Update deployment schedule.",
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
    schedule: DeploymentScheduleSchema,
  }),
  response: {
    200: {
      description: "Deployment schedule updated successfully.",
      content: {
        "application/json": {
          schema: DeploymentUpdateScheduleSuccess,
        },
      },
    },
    400: {
      description: "Bad Request. Invalid input data.",
      content: {
        "application/json": {
          schema: {
            $ref: "Error",
          },
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
