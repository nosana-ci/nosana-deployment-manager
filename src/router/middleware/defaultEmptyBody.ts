/**
 * Lets a route whose body schema has only optional fields be called with no
 * body at all. Fastify validates `body` even when the request carried none,
 * and `undefined` fails an object schema — so a bare POST would be a 400
 * "body must be object". Register it at preValidation, i.e. before that check.
 *
 * Typed structurally rather than as a Fastify hook on purpose: a hook carrying
 * Fastify's default route generics would win the route's type inference and
 * clash with the typed deployment middleware registered alongside it.
 */
export async function defaultEmptyBodyMiddleware(req: { body?: unknown }): Promise<void> {
  if (req.body === undefined) req.body = {};
}
