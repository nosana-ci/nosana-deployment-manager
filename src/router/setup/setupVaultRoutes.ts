import { FastifyInstance } from "fastify";

import { getVaultMiddleware } from "../middleware/index.js";

import { routes } from "../routes/index.js";
import { routeSchemas } from "../schema/index.schema.js";

const {
  post: { vaultWithdrawHandler },
  patch: { vaultUpdateBalanceHandler },
} = routes;
const {
  post: { VaultWithdrawSchema },
  patch: { VaultUpdateBalanceSchema },
} = routeSchemas;

export function setupVaultRoutes(server: FastifyInstance) {
  server.post(
    "/api/vault/:vault/withdraw",
    {
      schema: VaultWithdrawSchema,
      preHandler: [getVaultMiddleware],
    },
    vaultWithdrawHandler
  );

  server.patch(
    "/api/vault/:vault/update-balance",
    {
      schema: VaultUpdateBalanceSchema,
      preHandler: [getVaultMiddleware],
    },
    vaultUpdateBalanceHandler
  );
}
