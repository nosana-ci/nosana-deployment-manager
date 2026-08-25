import { FastifySchema } from "fastify";
import { Static, Type } from "@sinclair/typebox";

import { ErrorSchema } from "../../../index.schema.js";
import { SshPublicKeysSchema } from "../../../components/ssh.schema.js";

export const DeploymentUpdateSshKeysBody = Type.Object({
  public_keys: SshPublicKeysSchema,
});

export type DeploymentUpdateSshKeysBody = Static<typeof DeploymentUpdateSshKeysBody>;

export const JobSshKeysResultSchema = Type.Object({
  job: Type.String(),
  node: Type.String(),
  status: Type.Union([Type.Literal("authorized"), Type.Literal("failed")]),
  error: Type.Optional(Type.String()),
});

export type JobSshKeysResult = Static<typeof JobSshKeysResultSchema>;

const DeploymentUpdateSshKeysSuccess = Type.Object({
  public_keys: Type.Array(Type.String()),
  updated_at: Type.String({ format: "date-time" }),
  jobs: Type.Array(JobSshKeysResultSchema, {
    description:
      "Per running job: whether its node authorized the new keys. Empty when the new set is empty — a revocation cannot reach running jobs.",
  }),
});

export type DeploymentUpdateSshKeysSuccess = Static<typeof DeploymentUpdateSshKeysSuccess>;
export type DeploymentUpdateSshKeysError = ErrorSchema;

export const DeploymentUpdateSshKeysSchema: FastifySchema = {
  description:
    "Replace the deployment's SSH public keys. The new set is stored on the deployment (not on a revision — no new revision or restart) and injected into every job posted from now on. New keys are also authorized on the node of every job currently running; removed keys stop working only when a job restarts.",
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
  body: DeploymentUpdateSshKeysBody,
  response: {
    200: {
      description: "SSH keys updated. Check `jobs` for nodes that rejected or did not receive the new keys.",
      content: {
        "application/json": {
          schema: DeploymentUpdateSshKeysSuccess,
        },
      },
    },
    400: {
      description: "Bad Request. A key is not a valid OpenSSH public key, or the set exceeds the limits.",
      content: {
        "application/json": {
          schema: {
            $ref: "Error",
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
