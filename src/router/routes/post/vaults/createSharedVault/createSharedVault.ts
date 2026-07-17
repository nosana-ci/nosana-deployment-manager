import { RouteHandler } from "fastify";

import { HeadersSchema } from "../../../../schema/index.schema.js";
import { getOrCreateVault } from "./createSharedVaultFactory.js";
import { CreateSharedVaultSuccess, CreateSharedVaultError } from "../../../../schema/post/index.schema.js";

export const createSharedVaultHandler: RouteHandler<{
  Headers: HeadersSchema;
  Reply: CreateSharedVaultSuccess | CreateSharedVaultError;
}> = async (req, res) => {
  const userId = req.headers["x-user-id"];

  try {
    const vault = await getOrCreateVault({ owner: userId, createNew: true });

    res.status(200);
    return vault;
  } catch (error) {
    res.log.error("Error creating vault: %s", String(error));
    res.status(500).send({ error: "Failed to create shared vault" });
  }
};
