import { Express } from "express";

import { getVaultMiddleware } from "../middleware/index.js";

import { vaultWithdrawHandler } from "../routes/post/index.js";
import { vaultUpdateBalanceHandler } from "../routes/patch/index.js";

export function setupVaultRoutes(app: Express) {
  app.post(
    "/api/vault/:vault/withdraw",
    getVaultMiddleware,
    vaultWithdrawHandler,
  );
  app.patch(
    "/api/vault/:vault/update-balance",
    getVaultMiddleware,
    vaultUpdateBalanceHandler,
  );
}
