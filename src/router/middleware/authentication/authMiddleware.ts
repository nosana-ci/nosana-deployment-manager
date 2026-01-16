import type { RouteHandler } from "fastify";

import { isJobHostRoute } from "./authJobHostMiddleware.js";

import type { HeadersSchema } from "../../schema/index.schema.js";
import { convertAddressToUnit8Array, getKit } from "../../../kit/index.js";

export const authMiddleware: RouteHandler<{
  Headers: HeadersSchema;
}> = async (req, res) => {
  if (!req.url.startsWith("/api/") || isJobHostRoute(req.url, req.method) || req.method === "OPTIONS") {
    return;
  }

  const userId = req.headers["x-user-id"];
  const authToken = req.headers["authorization"];

  if (typeof userId !== "string" || typeof authToken !== "string") {
    res.status(401).send("Unauthorized");
    return;
  }

  if (!authToken.startsWith("nos_")) {
    const kit = getKit();

    if (
      !kit.authorization.validateHeaders(req.headers, convertAddressToUnit8Array(userId), {
        expiry: 300,
      })
    ) {
      res.status(401).send("Unauthorized");
      return;
    }
  }
};
