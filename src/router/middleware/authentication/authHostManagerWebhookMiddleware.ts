import { timingSafeEqual } from "crypto";

import type { RouteHandler } from "fastify";

import { getConfig } from "../../../config/index.js";

/**
 * Host-manager authenticates its webhooks with the shared host-manager API key
 * as the `authorization` header, the same key we send it. The webhook routes
 * are internal (in-cluster), so the shared key is the whole check.
 */
export const authHostManagerWebhookMiddleware: RouteHandler<{ Body: unknown }> = async (req, res) => {
  const { host_manager_api_key } = getConfig();
  const { authorization } = req.headers;

  if (!host_manager_api_key || !authorization || !isSameKey(authorization, host_manager_api_key)) {
    res.status(401).send("Unauthorized");
    return;
  }
};

function isSameKey(given: string, expected: string): boolean {
  const givenBytes = Buffer.from(given);
  const expectedBytes = Buffer.from(expected);
  return givenBytes.length === expectedBytes.length && timingSafeEqual(givenBytes, expectedBytes);
}
