import { FastifySchema } from "fastify";

import { SshKeysBody, SshKeysResultSchema } from "../../../components/ssh.schema.js";

export const DeploymentAddSshKeysSchema: FastifySchema = {
  description:
    "Grant one or more SSH public keys access to a deployment's jobs. Keys already present (same type and material) are left as they are. The set is stored on the deployment — not on a revision, so nothing is redeployed — and injected into every job posted from now on; new keys are also authorized on the node of every job currently running.",
  tags: ["Deployments", "mcp"],
  headers: { $ref: "Headers" },
  params: {
    type: "object",
    properties: { deployment: { $ref: "PublicKey" } },
    required: ["deployment"],
  },
  body: SshKeysBody,
  response: {
    200: {
      description: "The deployment's SSH keys after the change. Check `jobs` for nodes that rejected or did not receive the new keys.",
      content: { "application/json": { schema: SshKeysResultSchema } },
    },
    400: {
      description: "Bad Request. A key is not a valid OpenSSH public key, or the set exceeds the limits.",
      content: { "application/json": { schema: { $ref: "Error" } } },
    },
    401: {
      description: "Unauthorized. Invalid or missing authentication.",
      content: { "application/json": { schema: { $ref: "Error" } } },
    },
    404: {
      description: "Deployment not found.",
      content: { "application/json": { schema: { $ref: "Error" } } },
    },
    500: {
      description: "Internal Server Error.",
      content: { "application/json": { schema: { $ref: "Error" } } },
    },
  },
  security: [{ Authorization: [] }],
};
