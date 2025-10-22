import { RouteHandler } from "fastify";

import { HeadersSchema } from "../../../../schema/index.schema.js";
import { createAndStoreSharedVault } from "./createSharedVaultFactory.js";
import { CreateSharedVaultSuccess, CreateSharedVaultError } from "../../../../schema/post/index.schema.js";

export const createSharedVaultHandler: RouteHandler<{
  Headers: HeadersSchema;
  Reply: CreateSharedVaultSuccess | CreateSharedVaultError;
}> = async (req, res) => {
  const { db } = res.locals;
  const userId = req.headers["x-user-id"];

  const { acknowledged, vault } = await createAndStoreSharedVault(db.vaults, userId, new Date());

  if (!acknowledged) {
    res.status(500).send({ error: "Failed to create shared vault" });
    return;
  }

  res.status(200);
  return vault
}