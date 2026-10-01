import { describe, it, expect } from "vitest";
import type { FastifyRouteSchemaDef } from "fastify/types/schema.js";
import type { FastifySchema } from "fastify";

import { deploymentCreateValidation } from "./deploymentCreateValidation.js";

const MARKET = "M".repeat(44);
const REQUIREMENTS = { name: "NVIDIA GeForce RTX 4090", ram_gb: 64, cuda_driver_version: "13", soc_2: true };

const validate = deploymentCreateValidation({ httpPart: "body" } as FastifyRouteSchemaDef<FastifySchema>) as (
  data: unknown
) => { value?: unknown; error?: Error };

const body = (placement: Record<string, unknown>) => ({
  name: "dep",
  replicas: 1,
  timeout: 60,
  strategy: "SIMPLE",
  job_definition: {
    version: "0.1",
    type: "container",
    ops: [{ type: "container/run", id: "run", args: { image: "ubuntu" } }],
  },
  ...placement,
});

describe("deploymentCreateValidation market / requirements", () => {
  it("accepts a market only", () => {
    expect(validate(body({ market: MARKET })).error).toBeUndefined();
  });

  it("accepts requirements only", () => {
    expect(validate(body({ requirements: REQUIREMENTS })).error).toBeUndefined();
  });

  it("rejects both with a clear message", () => {
    expect(validate(body({ market: MARKET, requirements: REQUIREMENTS })).error?.message).toBe(
      "exactly one of market or requirements is required"
    );
  });

  it("rejects neither with a clear message", () => {
    expect(validate(body({})).error?.message).toBe("exactly one of market or requirements is required");
  });

  it("rejects empty requirements", () => {
    expect(validate(body({ requirements: {} })).error).toBeInstanceOf(Error);
  });

  it.each([{ nested: { a: 1 } }, { list: [1, 2] }, { missing: null }])(
    "rejects a non-scalar requirement value %j",
    (requirements) => {
      expect(validate(body({ requirements })).error).toBeInstanceOf(Error);
    }
  );

  it("rejects a market that is not a public key", () => {
    expect(validate(body({ market: "not-a-key" })).error).toBeInstanceOf(Error);
  });
});
