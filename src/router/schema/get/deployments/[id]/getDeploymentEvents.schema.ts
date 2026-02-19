import { FastifySchema } from "fastify";
import { Type } from "@sinclair/typebox";

import { ErrorSchema, EventSchema } from "../../../index.schema.js";
import {
  withPagination,
  withFilters,
  type WithPagination,
} from "../../../components/pagination.schema.js";
import { EventsFilterSchema } from "../../../components/filters.schema.js";

export type GetDeploymentEventsSuccess = WithPagination<EventSchema, "events">;
export type GetDeploymentEventsError = ErrorSchema;

export const GetDeploymentEventsSchema: FastifySchema = {
  description: "Get events for a specific deployment.",
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
  querystring: withFilters(EventsFilterSchema),
  response: {
    200: {
      description: "List of events for the deployment with pagination.",
      content: {
        "application/json": {
           schema: withPagination("events", Type.Ref("Event")),
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
