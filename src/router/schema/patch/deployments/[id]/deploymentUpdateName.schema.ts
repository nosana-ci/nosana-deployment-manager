import { FastifySchema } from "fastify";
import { Static, Type } from "@sinclair/typebox";
import { ErrorSchema } from "../../../index.schema";

const DeploymentUpdateNameSuccess = Type.Object({
  name: Type.String(),
  updated_at: Type.String({ format: "date-time" }),
});

export type DeploymentUpdateNameSuccess = Static<
  typeof DeploymentUpdateNameSuccess
>;
export type DeploymentUpdateNameError = ErrorSchema;

export const DeploymentUpdateNameSchema: FastifySchema = {
  description: "Update the name of a deployment",
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
    name: Type.String({ minLength: 1 }),
  }),
  response: {
    200: {
      description: "Deployment name updated successfully.",
      content: {
        "application/json": {
          schema: DeploymentUpdateNameSuccess,
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
