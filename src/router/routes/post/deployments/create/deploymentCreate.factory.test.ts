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

import { createDeployment } from "./deploymentCreate.factory.js";

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
