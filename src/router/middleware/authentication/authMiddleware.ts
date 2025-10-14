import { Wallet } from "@coral-xyz/anchor";
import type { RouteHandler } from "fastify";
import { AuthorizationManager } from "@nosana/sdk";
import { Keypair, PublicKey } from "@solana/web3.js";

import { isJobHostRoute } from "./authJobHostMiddleware.js";

import type { HeadersSchema } from "../../schema/index.schema.js";

export const authMiddleware: RouteHandler<{
  Headers: HeadersSchema;
}> = async (req, res) => {
  if (!req.url.startsWith("/api/") || isJobHostRoute(req.url, req.method) || req.method === "OPTIONS") {
    return;
  }

  const authorizationManager = new AuthorizationManager(
    new Wallet(new Keypair())
  );

  const userId = req.headers["x-user-id"];
  const authToken = req.headers["authorization"];

  if (typeof userId !== "string" || typeof authToken !== "string") {
    res.status(401).send("Unauthorized");
    return;
  }

  if (
    !authorizationManager.validateHeader(req.headers, {
      publicKey: new PublicKey(userId as string),
      expiry: 300,
    })
  ) {
    res.status(401).send("Unauthorized");
    return;
  }
};
