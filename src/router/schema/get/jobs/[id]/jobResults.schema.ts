import { FastifySchema } from "fastify";
import { Type } from "@sinclair/typebox";

import type { ErrorSchema, JobResultsSchema } from "../../../index.schema.js";

export type JobResultsHandlerSuccess = JobResultsSchema;
export type JobResultsHandlerError = ErrorSchema;

export const JobResultsHandlerSchema: FastifySchema = {
  description: "Returns a jobs results.",
  tags: ["Deployments Jobs"],
  headers: {
    $ref: "Headers",
  },
  response: {
    200: {
      description: "Job results.",
      content: {
        "application/json": {
          schema: {
            $ref: "JobResults",
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
