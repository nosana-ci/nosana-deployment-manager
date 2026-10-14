import { describe, it, expect } from "vitest";
import fastify from "fastify";

import { invalidJsonError, registerErrorHandler } from "./errorHandler.js";

const ErrorResponse = { type: "object", properties: { error: { type: "string" } } };

async function app() {
  const server = fastify();
  server.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      done(invalidJsonError(err), undefined);
    }
  });
  registerErrorHandler(server);
  server.post(
    "/create",
    {
      schema: { body: { type: "object" }, response: { 400: ErrorResponse, 500: ErrorResponse } },
      validatorCompiler: () => () => ({ error: new Error("strategy: Expected required property") }),
    },
    async () => ({ ok: true })
  );
  server.get("/boom", { schema: { response: { 500: ErrorResponse } } }, async () => {
    throw new Error("database password is hunter2");
  });
  return server;
}

describe("registerErrorHandler", () => {
  it("returns the validation reason in `error`, which the response schema keeps", async () => {
    const res = await (await app()).inject({ method: "POST", url: "/create", payload: { name: "x" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("strategy: Expected required property");
  });

  it("answers a body that is not JSON with a 400 that says so", async () => {
    const res = await (await app()).inject({
      method: "POST",
      url: "/create",
      headers: { "content-type": "application/json" },
      payload: '{"ops": [}]',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("not valid JSON");
  });

  it("keeps server errors as they were", async () => {
    const res = await (await app()).inject({ method: "GET", url: "/boom" });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain("hunter2");
  });
});
