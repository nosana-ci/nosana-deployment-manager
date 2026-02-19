import { FastifySchema } from "fastify";
import { Type } from "@sinclair/typebox";

import type { ErrorSchema } from "../../index.schema.js";
import { DeploymentSchema } from "../../index.schema.js";
import {
  withPagination,
  withFilters,
  type WithPagination,
} from "../../components/pagination.schema.js";
import { DeploymentsFilterSchema } from "../../components/filters.schema.js";

export type DeploymentsHandlerSuccess = WithPagination<DeploymentSchema, "deployments">;
export type DeploymentsHandlerError = ErrorSchema;

export const DeploymentsHandlerSchema: FastifySchema = {
  description: "List all user deployments.",
  tags: ["Deployments"],
  headers: {
    $ref: "Headers",
  },
  querystring: withFilters(DeploymentsFilterSchema),
  response: {
    200: {
      description: "List of deployments with pagination.",
      content: {
        "application/json": {
           schema: withPagination("deployments", Type.Ref("Deployment")),
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
