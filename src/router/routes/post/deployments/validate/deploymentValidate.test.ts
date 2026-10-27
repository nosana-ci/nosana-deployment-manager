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

const jobDefinition = {
  version: "0.1",
  type: "container",
  ops: [{ type: "container/run", id: "server", args: { image: "docker.io/ollama/ollama" } }],
};

const validate = async (payload: unknown) =>
  (await app()).inject({ method: "POST", url: "/deployments/validate", payload: payload as object });

describe("POST /deployments/validate", () => {
  it("accepts a job definition create would accept", async () => {
    const res = await validate({ job_definition: jobDefinition });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ valid: true, errors: [] });
  });

  it("lists what the Kit's validator rejects, without failing the request", async () => {
    const res = await validate({ job_definition: { ...jobDefinition, ops: [{ id: "server", args: {} }] } });
    expect(res.statusCode).toBe(200);
    expect(res.json().valid).toBe(false);
    expect(res.json().errors).toContain(
      'job_definition.ops[0].type: expected ("container/create-volume" | "container/run" | "cvm/run" | "vm/run")'
    );
  });

  it("asks for a job definition when there is none", async () => {
    expect((await validate({})).json()).toEqual({ valid: false, errors: ["job_definition: Expected required property"] });
  });

  it("is published for MCP as a read-only tool", async () => {
    const server = await app();
    const operation = (server.swagger() as { paths: Record<string, Record<string, Record<string, unknown>>> })
      .paths["/deployments/validate"]!.post!;
    expect(operation["x-mcp-read-only"]).toBe(true);
    expect(operation.tags).toContain("mcp");
  });
});
