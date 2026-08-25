import { describe, it, expect } from "vitest";
import type { JobDefinition } from "@nosana/kit";

import { extractSsh, injectSsh, stripSsh } from "./jobDefinition.js";

const base: JobDefinition = {
  version: "0.1",
  type: "container",
  ops: [{ type: "container/run", id: "web", args: { image: "nginx" } }],
};

const KEY_A = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIB0XqCL4vLIsYRvd5VmtbOJ8IEKDJpjaVWQ5lmxWVTq5 a";
const KEY_B = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIB0XqCL4vLIsYRvd5VmtbOJ8IEKDJpjaVWQ5lmxWVTq5 b";

describe("extractSsh", () => {
  it("splits the keys off and returns the definition without an ssh block", () => {
    const { jobDefinition, public_keys } = extractSsh({ ...base, ssh: { public_keys: [` ${KEY_A} `, KEY_B] } });

    expect(public_keys).toEqual([KEY_A, KEY_B]);
    expect(jobDefinition).toEqual(base);
    expect("ssh" in jobDefinition).toBe(false);
  });

  it("reports no keys for a definition without any, without mutating the input", () => {
    const input = { ...base };
    const { jobDefinition, public_keys } = extractSsh(input);

    expect(public_keys).toBeUndefined();
    expect(jobDefinition).toEqual(base);
    expect(input).toEqual(base);
  });

  it("treats an empty or whitespace-only key list as no keys", () => {
    expect(extractSsh({ ...base, ssh: { public_keys: [] } }).public_keys).toBeUndefined();
    expect(extractSsh({ ...base, ssh: { public_keys: ["  "] } }).public_keys).toBeUndefined();
    expect(extractSsh({ ...base, ssh: {} }).public_keys).toBeUndefined();
  });
});

describe("stripSsh / injectSsh", () => {
  it("stripSsh removes the block and leaves everything else intact", () => {
    expect(stripSsh({ ...base, ssh: { public_keys: [KEY_A] } })).toEqual(base);
  });

  it("injectSsh adds the deployment's current keys", () => {
    expect(injectSsh(base, [KEY_A])).toEqual({ ...base, ssh: { public_keys: [KEY_A] } });
  });

  it("injectSsh replaces stale keys already on the definition", () => {
    const stale: JobDefinition = { ...base, ssh: { public_keys: [KEY_A] } };
    expect(injectSsh(stale, [KEY_B])).toEqual({ ...base, ssh: { public_keys: [KEY_B] } });
  });

  it("injectSsh with no keys yields the bare definition (and drops a stale block)", () => {
    expect(injectSsh(base, undefined)).toEqual(base);
    expect(injectSsh({ ...base, ssh: { public_keys: [KEY_A] } }, undefined)).toEqual(base);
    expect(injectSsh(base, [])).toEqual(base);
  });
});
