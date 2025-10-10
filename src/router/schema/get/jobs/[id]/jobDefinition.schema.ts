import { FastifySchema } from "fastify";
import { Type } from "@sinclair/typebox";
import { JobDefinition } from "@nosana/sdk";

import type { ErrorSchema } from "../../../index.schema.js";

export type JobDefinitionHandlerSuccess = JobDefinition;
export type JobDefinitionHandlerError = ErrorSchema;

export const JobDefinitionHandlerSchema: FastifySchema = {
  description: "Returns the job definition for a job.",
  tags: ["Jobs"],
  headers: {
    $ref: "Headers",
  },
  response: {
    200: {
      description: "Job definition details.",
      content: {
        "application/json": {
          schema: {
            $ref: "JobDefinition",
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
