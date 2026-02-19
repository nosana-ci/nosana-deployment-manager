import { FastifySchema } from "fastify";
import { Type } from "@sinclair/typebox";

import { ErrorSchema, RevisionSchema } from "../../../index.schema.js";
import {
  withPagination,
  withFilters,
  type WithPagination,
} from "../../../components/pagination.schema.js";
import { RevisionsFilterSchema } from "../../../components/filters.schema.js";

export type GetDeploymentRevisionsSuccess = WithPagination<RevisionSchema, "revisions">;
export type GetDeploymentRevisionsError = ErrorSchema;

export const GetDeploymentRevisionsSchema: FastifySchema = {
  description: "Get revisions for a specific deployment.",
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
  querystring: withFilters(RevisionsFilterSchema),
  response: {
    200: {
      description: "List of revisions for the deployment with pagination.",
      content: {
        "application/json": {
           schema: withPagination("revisions", Type.Ref("Revision")),
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
