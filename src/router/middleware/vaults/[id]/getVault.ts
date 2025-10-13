import type { RouteHandler } from "fastify";

import { ErrorMessages } from "../../../../errors/index.js";

import type { HeadersSchema } from "../../../schema/index.schema.js";

export const getVaultMiddleware: RouteHandler<{
  Params: { vault: string };
  Headers: HeadersSchema;
}> = async (req, res) => {
  const { db } = res.locals;
  const vaultId = req.params.vault;
  const userId = req.headers["x-user-id"];

  try {
    const vault = await db.vaults.findOne({
      vault: vaultId,
      owner: userId,
    });

    if (vault === null) {
      res.status(404).send({ error: ErrorMessages.vaults.NOT_FOUND });
      return;
    }

    res.locals.vault = vault;
  } catch (error) {
    res.log.error(error);
    res
      .status(500)
      .send({ error: ErrorMessages.generic.SOMETHING_WENT_WRONG });
  }
};
