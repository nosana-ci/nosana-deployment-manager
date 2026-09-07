import { FastifySchema } from "fastify";

import { SshKeysBody, SshKeysResultSchema } from "../../../components/ssh.schema.js";

export const DeploymentRevokeSshKeysSchema: FastifySchema = {
  description:
    "Revoke one or more SSH public keys from a deployment's jobs. A key is matched by its type and material, so a differing comment still revokes it. The key is removed from the deployment's set (future jobs won't get it) and revoked on the node of every job currently running, so access stops at once rather than only when a job restarts.",
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
      description: "The deployment's SSH keys after the change. Check `jobs` for nodes that did not apply the revocation.",
      content: { "application/json": { schema: SshKeysResultSchema } },
    },
    400: {
      description: "Bad Request. A key is not a valid OpenSSH public key.",
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
