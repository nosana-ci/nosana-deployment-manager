import { FastifySchema } from "fastify";
import { Static, Type } from "@sinclair/typebox";
import { ErrorSchema } from "../../../index.schema";

const DeploymentUpdateActiveRevisionSuccess = Type.Object({
  active_revision: Type.Number(),
  updated_at: Type.String(),
});

export type DeploymentUpdateActiveRevisionSuccess = Static<
  typeof DeploymentUpdateActiveRevisionSuccess
>;
export type DeploymentUpdateActiveRevisionError = ErrorSchema;

export const DeploymentUpdateActiveRevisionSchema: FastifySchema = {
  description: "Update deployment active revision.",
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
    active_revision: Type.Number({ minimum: 1 }),
  }),
  response: {
    200: {
      description: "Deployment active revision updated successfully.",
      content: {
        "application/json": {
          schema: DeploymentUpdateActiveRevisionSuccess,
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
