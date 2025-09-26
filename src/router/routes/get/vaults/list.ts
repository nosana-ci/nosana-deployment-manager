import type { RouteHandler } from "fastify";

import type {
  VaultsHandlerSuccess,
  VaultsHandlerError,
} from "../../../schema/get/vaults/list.schema.js";
import type { HeadersSchema } from "../../../schema/index.schema.js";

export const vaultsHandler: RouteHandler<{
  Headers: HeadersSchema;
  Reply: VaultsHandlerSuccess | VaultsHandlerError;
}> = async (req, res) => {
  const { db } = res.locals;
  const userId = req.headers["x-user-id"];

  try {
    const vaults = await db.vaults.find({ owner: userId }).toArray();

    res.status(200);
    return vaults.map(({ vault, owner, created_at }) => ({
      vault, owner, created_at: created_at.toISOString()
    }));
  } catch (error) {
    res.log.error("Error fetching vaults:", error);
    res.status(500).send({ error: "Internal Server Error" });
  }
};
