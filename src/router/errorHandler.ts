import type { FastifyInstance } from "fastify";

/**
 * Client errors carry their reason in `error`. Routes declare their 4xx responses as
 * `{ error: string }`, so Fastify's default body, which keeps the reason in `message`,
 * would be serialised down to `{ error: "Bad Request" }`. Server errors keep the default.
 */
export function registerErrorHandler(server: FastifyInstance): void {
  server.setErrorHandler((error, _request, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 500) return reply.send(error);
    return reply.status(status).send({ error: error.message });
  });
}

/** A request body that is not valid JSON, as a client error rather than a crash. */
export function invalidJsonError(cause: unknown): Error & { statusCode: number } {
  const reason = cause instanceof Error ? cause.message : String(cause);
  return Object.assign(new Error(`The request body is not valid JSON: ${reason}`), { statusCode: 400 });
}
