import { FastifySchema } from "fastify";
import { Type } from "@sinclair/typebox";

import { ErrorSchema, TaskSchema } from "../../../index.schema.js";
import {
  withPagination,
  withFilters,
  type WithPagination,
} from "../../../components/pagination.schema.js";
import { TasksFilterSchema } from "../../../components/filters.schema.js";

export type GetDeploymentScheduledTasksSuccess = WithPagination<TaskSchema, "tasks">;
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
  querystring: withFilters(TasksFilterSchema),
  response: {
    200: {
      description: "List of scheduled tasks for the deployment with pagination.",
      content: {
        "application/json": {
           schema: withPagination("tasks", Type.Ref("Task")),
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
