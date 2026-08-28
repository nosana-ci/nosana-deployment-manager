import { describe, it, expect, vi, beforeEach } from "vitest";
import type { JobDefinition } from "@nosana/kit";

import type { DeploymentCreateBody } from "../../../../schema/post/index.schema.js";

const pin = vi.fn(async () => "QmPinned");
vi.mock("../../../../../kit/index.js", () => ({ getKit: () => ({ ipfs: { pin } }) }));
vi.mock("../../../../../config/index.js", () => ({
  getConfig: () => ({
    confidential_by_default: false,
    frps_public_address: "node.k8s.test.nos.ci",
    default_minutes_before_timeout: 20,
  }),
}));
vi.mock("@solana/signers", () => ({
  generateKeyPairSigner: async () => ({ address: "D".repeat(44) }),
}));

import { createDeployment, hasExposedPorts } from "./deploymentCreate.factory.js";

const OWNER = "1".repeat(44);
const VAULT = "3".repeat(44);
const KEY_A = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIB0XqCL4vLIsYRvd5VmtbOJ8IEKDJpjaVWQ5lmxWVTq5 a";
const KEY_B = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIB0XqCL4vLIsYRvd5VmtbOJ8IEKDJpjaVWQ5lmxWVTq5 b";

const definition: JobDefinition = { version: "0.1", type: "container", ops: [] };

function makeBody(over: Partial<DeploymentCreateBody> = {}): DeploymentCreateBody {
  return {
    name: "dep",
    market: "M".repeat(43),
    replicas: 1,
    timeout: 60,
    strategy: "SIMPLE",
    job_definition: definition,
    ...over,
  } as DeploymentCreateBody;
}

const create = (body: DeploymentCreateBody) => createDeployment(body, VAULT, OWNER, new Date());

const exposing = (expose: unknown): JobDefinition =>
  ({
    version: "0.1",
    type: "container",
    ops: [{ type: "container/run", id: "op-1", args: { image: "img", expose } }],
  } as unknown as JobDefinition);

describe("hasExposedPorts", () => {
  it("is false when no op exposes anything — nothing could ever open a tunnel", () => {
    expect(hasExposedPorts(definition)).toBe(false);
    expect(hasExposedPorts(exposing(undefined))).toBe(false);
  });

  it("is true for a bare port, string or number", () => {
    expect(hasExposedPorts(exposing(8080))).toBe(true);
    expect(hasExposedPorts(exposing("8080"))).toBe(true);
  });

  it("is true for a list of ports or service objects", () => {
    expect(hasExposedPorts(exposing([8080]))).toBe(true);
    expect(hasExposedPorts(exposing([{ port: 8080 }]))).toBe(true);
  });

  it("is false for an empty list", () => {
    expect(hasExposedPorts(exposing([]))).toBe(false);
  });

  it("ignores ops that are not container/run", () => {
    const definitionWithOtherOp = {
      version: "0.1",
      type: "container",
      ops: [{ type: "container/create-volume", id: "vol", args: { expose: 8080 } }],
    } as unknown as JobDefinition;

    expect(hasExposedPorts(definitionWithOtherOp)).toBe(false);
  });
});

describe("createDeployment startup_timeout", () => {
  it("stores the startup timeout on an INFINITE deployment", async () => {
    const { deployment } = await create(
      makeBody({ strategy: "INFINITE", timeout: 60, startup_timeout: 5 }),
    );

    expect(deployment).toMatchObject({ strategy: "INFINITE", startup_timeout: 5 });
  });

  it("leaves the field off when it was not requested", async () => {
    const { deployment } = await create(makeBody({ strategy: "INFINITE", timeout: 60 }));

    expect(deployment).not.toHaveProperty("startup_timeout");
  });
});

describe("createDeployment ssh keys", () => {
  beforeEach(() => {
    pin.mockClear();
  });

  it("stores top-level ssh_public_keys and pins the definition with them merged in", async () => {
    const { deployment, revision } = await create(makeBody({ ssh_public_keys: [KEY_A] }));

    expect(deployment.ssh_public_keys).toEqual([KEY_A]);
    expect(revision.job_definition.ssh).toBeUndefined();
    expect(pin).toHaveBeenCalledWith(expect.objectContaining({ ssh: { public_keys: [KEY_A] } }));
  });

  it("top-level keys take precedence over an ssh block embedded in the definition", async () => {
    const { deployment } = await create(
      makeBody({
        ssh_public_keys: [KEY_A],
        job_definition: { ...definition, ssh: { public_keys: [KEY_B] } },
      })
    );

    expect(deployment.ssh_public_keys).toEqual([KEY_A]);
    expect(pin).toHaveBeenCalledWith(expect.objectContaining({ ssh: { public_keys: [KEY_A] } }));
  });

  it("keys embedded in the definition still work without the top-level field", async () => {
    const { deployment, revision } = await create(
      makeBody({ job_definition: { ...definition, ssh: { public_keys: [KEY_B] } } })
    );

    expect(deployment.ssh_public_keys).toEqual([KEY_B]);
    expect(revision.job_definition.ssh).toBeUndefined();
    expect(pin).toHaveBeenCalledWith(expect.objectContaining({ ssh: { public_keys: [KEY_B] } }));
  });

  it("a confidential deployment stores the keys but pins a key-free definition", async () => {
    const { deployment } = await create(
      makeBody({ confidential: true, ssh_public_keys: [KEY_A] })
    );

    expect(deployment.ssh_public_keys).toEqual([KEY_A]);
    expect(pin).toHaveBeenCalledTimes(1);
    expect(pin.mock.calls[0][0]).not.toHaveProperty("ssh");
  });

  it("stores no ssh field when no keys are supplied anywhere", async () => {
    const { deployment } = await create(makeBody());

    expect(deployment.ssh_public_keys).toBeUndefined();
    expect(pin.mock.calls[0][0]).not.toHaveProperty("ssh");
  });
});
