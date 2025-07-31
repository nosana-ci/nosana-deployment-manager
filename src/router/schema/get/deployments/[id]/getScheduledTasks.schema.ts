import { FastifySchema } from "fastify";

import { TaskDocument } from "../../../../../types/index.js";
import { ErrorSchema } from "../../../index.schema";

export type GetDeploymentScheduledTasksSuccess = Array<TaskDocument>;
export type GetDeploymentScheduledTasksError = ErrorSchema;

export const GetDeploymentScheduledTasksSchema: FastifySchema = {
  description: "Get scheduled tasks for a specific deployment.",
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
  response: {
    200: {
      description: "List of scheduled tasks for the deployment.",
      content: {
        "application/json": {
          schema: {
            type: "array",
            items: {
              $ref: "Task",
            },
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
};
