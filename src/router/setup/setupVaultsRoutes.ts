import { FastifyInstance } from "fastify";

import { routes } from "../routes/index.js";
import { API_PREFIX } from "../../definitions/api.js";
import { getVaultMiddleware } from "../middleware/index.js";

import { routeSchemas } from "../schema/index.schema.js";

const VAULTS_API_PREFIX = `${API_PREFIX}/vaults`;

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
    VAULTS_API_PREFIX,
    {
      schema: VaultsHandlerSchema,
    },
    vaultsHandler
  )

  server.post(
    `${VAULTS_API_PREFIX}/create`,
    {
      schema: CreateSharedVaultSchema,
    },
    createSharedVaultHandler
  )

  server.post(
    `${VAULTS_API_PREFIX}/:vault/withdraw`,
    {
      schema: VaultWithdrawSchema,
      preHandler: [getVaultMiddleware],
    },
    vaultWithdrawHandler
  );
}
