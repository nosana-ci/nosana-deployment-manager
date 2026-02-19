import { FastifySchema } from "fastify";
import { Type } from "@sinclair/typebox";

import { ErrorSchema, JobSchema } from "../../../index.schema.js";
import {
  withFilters,
  withPagination,
  type WithPagination,
} from "../../../components/pagination.schema.js";
import { JobsFilterSchema } from "../../../components/filters.schema.js";

export type GetDeploymentJobsSuccess = WithPagination<JobSchema, "jobs">;
export type GetDeploymentJobsError = ErrorSchema;

export const GetDeploymentJobsSchema: FastifySchema = {
  description: "Get jobs for a specific deployment.",
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
  querystring: withFilters(JobsFilterSchema),
  response: {
    200: {
      description: "List of jobs for the deployment with pagination.",
      content: {
        "application/json": {
           schema: withPagination("jobs", Type.Ref("Job")),
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
