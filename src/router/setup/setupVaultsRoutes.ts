import { FastifyInstance } from "fastify";

import { routes } from "../routes/index.js";
import { getVaultMiddleware } from "../middleware/index.js";

import { routeSchemas } from "../schema/index.schema.js";

const {
  get: { vaultsHandler },
  post: { vaultWithdrawHandler, createSharedVaultHandler },
} = routes;
const {
  get: { VaultsHandlerSchema },
  post: { VaultWithdrawSchema, CreateSharedVaultSchema },
} = routeSchemas;

export function setupVaultRoutes(server: FastifyInstance) {
  server.get(
    "/api/vaults",
    {
      schema: VaultsHandlerSchema,
    },
    vaultsHandler
  )

  server.post(
    "/api/vault/create",
    {
      schema: CreateSharedVaultSchema,
    },
    createSharedVaultHandler
  )

  server.post(
    "/api/vault/:vault/withdraw",
    {
      schema: VaultWithdrawSchema,
      preHandler: [getVaultMiddleware],
    },
    vaultWithdrawHandler
  );
}
