import { FastifySchema } from "fastify";
import { Static, Type } from "@sinclair/typebox";

import type { ErrorSchema } from "../../../index.schema.js";

const JobResultsSchema = Type.Object({
  message: Type.Literal("Success")
})

export type JobResultsPostHandlerSuccess = Static<typeof JobResultsSchema>;
export type JobResultsPostHandlerError = ErrorSchema;

export const JobResultPostHandlerSchema: FastifySchema = {
  description: "Post results for your running job.",
  tags: ["Jobs"],
  headers: {
    $ref: "HostHeaders",
  },
  body: {
    $ref: "JobResults",
  },
  response: {
    200: {
      description: "Job results details.",
      content: {
        "application/json": {
          schema: JobResultsSchema,
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
