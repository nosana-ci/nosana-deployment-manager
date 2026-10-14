import { describe, it, expect } from "vitest";
import fastify from "fastify";
import swagger from "@fastify/swagger";

import { addSchemas } from "../../../../schema/index.schema.js";
import { DeploymentValidateSchema } from "../../../../schema/post/index.schema.js";
import { deploymentValidateHandler } from "./deploymentValidate.js";

async function app() {
  const server = fastify();
  await server.register(swagger, { openapi: { openapi: "3.0.0", info: { title: "t", version: "1" } } });
  addSchemas(server);
  server.post(
    "/deployments/validate",
    { schema: DeploymentValidateSchema, validatorCompiler: () => (data) => ({ value: data }) },
    deploymentValidateHandler
  );
  await server.ready();
  return server;
}

const valid = {
  name: "ollama",
  market: "M".repeat(44),
  replicas: 1,
  timeout: 60,
  strategy: "SIMPLE",
  job_definition: {
    version: "0.1",
    type: "container",
    ops: [{ type: "container/run", id: "server", args: { image: "docker.io/ollama/ollama" } }],
  },
};

const validate = async (payload: unknown) =>
  (await app()).inject({ method: "POST", url: "/deployments/validate", payload: payload as object });

describe("POST /deployments/validate", () => {
  it("accepts a body create would accept", async () => {
    const res = await validate(valid);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ valid: true, errors: [] });
  });

  it("lists what create would reject, without failing the request", async () => {
    const withoutStrategy = Object.fromEntries(Object.entries(valid).filter(([key]) => key !== "strategy"));
    const res = await validate(withoutStrategy);
    expect(res.statusCode).toBe(200);
    expect(res.json().valid).toBe(false);
    expect(res.json().errors.join(" ")).toContain("strategy");
  });

  it("reports a job definition the Kit's validator rejects", async () => {
    const res = await validate({ ...valid, job_definition: { ...valid.job_definition, ops: [{ id: "server", args: {} }] } });
    expect(res.json().valid).toBe(false);
    expect(res.json().errors.some((error: string) => error.startsWith("job_definition"))).toBe(true);
  });

  it("is published for MCP as a read-only tool", async () => {
    const server = await app();
    const operation = (server.swagger() as { paths: Record<string, Record<string, Record<string, unknown>>> })
      .paths["/deployments/validate"]!.post!;
    expect(operation["x-mcp-read-only"]).toBe(true);
    expect(operation.tags).toContain("mcp");
  });
});
