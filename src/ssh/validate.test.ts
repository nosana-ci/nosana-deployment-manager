import { describe, it, expect } from "vitest";

import type { JobDefinition } from "@nosana/kit";

import {
  isSshPublicKey,
  validateSshPublicKeys,
  validateJobDefinitionSshKeys,
  MAX_SSH_PUBLIC_KEYS,
} from "./validate.js";

// A real ed25519 key: the blob embeds "ssh-ed25519" followed by 32 bytes.
const ED25519 = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIB0XqCL4vLIsYRvd5VmtbOJ8IEKDJpjaVWQ5lmxWVTq5";

/** Build a syntactically valid key for `algorithm` with `bodyBytes` of material. */
function makeKey(algorithm: string, bodyBytes = 32, comment?: string): string {
  const name = Buffer.from(algorithm, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(name.length, 0);
  const blob = Buffer.concat([length, name, Buffer.alloc(bodyBytes, 7)]).toString("base64");
  return `${algorithm} ${blob}${comment ? ` ${comment}` : ""}`;
}

describe("isSshPublicKey", () => {
  it("accepts a real ed25519 key, with or without a comment", () => {
    expect(isSshPublicKey(ED25519)).toBe(true);
    expect(isSshPublicKey(`${ED25519} alice@laptop`)).toBe(true);
  });

  it("accepts every algorithm the node accepts", () => {
    for (const algorithm of [
      "ssh-ed25519",
      "ssh-rsa",
      "ecdsa-sha2-nistp256",
      "ecdsa-sha2-nistp384",
      "ecdsa-sha2-nistp521",
      "sk-ssh-ed25519@openssh.com",
      "sk-ecdsa-sha2-nistp256@openssh.com",
    ]) {
      expect(isSshPublicKey(makeKey(algorithm)), algorithm).toBe(true);
    }
  });

  it("rejects unknown algorithms, mismatched prefixes and malformed blobs", () => {
    expect(isSshPublicKey(makeKey("ssh-dss"))).toBe(false);
    // prefix says rsa, blob says ed25519
    expect(isSshPublicKey(`ssh-rsa ${ED25519.split(" ")[1]}`)).toBe(false);
    expect(isSshPublicKey("ssh-ed25519 not-base64!!")).toBe(false);
    expect(isSshPublicKey("ssh-ed25519")).toBe(false);
    expect(isSshPublicKey("")).toBe(false);
    // algorithm name only, no key material
    expect(isSshPublicKey(makeKey("ssh-ed25519", 0))).toBe(false);
  });

  it("rejects authorized_keys-style entries with options (more than 3 fields)", () => {
    expect(isSshPublicKey(`restrict,pty ${ED25519} alice`)).toBe(false);
  });
});

describe("validateSshPublicKeys", () => {
  it("accepts an empty set (revokes access) and a valid set", () => {
    expect(validateSshPublicKeys([])).toBeNull();
    expect(validateSshPublicKeys([ED25519, makeKey("ssh-rsa", 256, "bob")])).toBeNull();
  });

  it("names the offending key", () => {
    expect(validateSshPublicKeys([ED25519, "garbage"])).toMatch(/public_keys\[1\]/);
  });

  it("rejects duplicates", () => {
    expect(validateSshPublicKeys([ED25519, ED25519])).toMatch(/duplicate/);
  });

  it("caps the number of keys like the node does", () => {
    const keys = Array.from({ length: MAX_SSH_PUBLIC_KEYS + 1 }, (_, i) => makeKey("ssh-ed25519", 32, `k${i}`));
    expect(validateSshPublicKeys(keys)).toMatch(/At most/);
    expect(validateSshPublicKeys(keys.slice(0, MAX_SSH_PUBLIC_KEYS))).toBeNull();
  });

  it("caps the total byte size like the node does", () => {
    // 9 keys × ~8 KiB each: each line stays under the per-line cap and the count
    // under the key cap, but together they blow the 64 KiB total.
    const keys = Array.from({ length: 9 }, (_, i) => makeKey("ssh-rsa", 6000, `k${i}`));
    expect(validateSshPublicKeys(keys)).toMatch(/bytes in total/);
  });
});

describe("validateJobDefinitionSshKeys", () => {
  const base: JobDefinition = { version: "0.1", type: "container", ops: [] };

  it("passes a definition without an ssh block or with valid trimmed keys", () => {
    expect(validateJobDefinitionSshKeys(base)).toBeNull();
    expect(validateJobDefinitionSshKeys({ ...base, ssh: {} })).toBeNull();
    expect(validateJobDefinitionSshKeys({ ...base, ssh: { public_keys: [` ${ED25519} `] } })).toBeNull();
  });

  it("rejects a definition whose ssh block breaks the node's rules", () => {
    expect(validateJobDefinitionSshKeys({ ...base, ssh: { public_keys: ["garbage"] } })).toMatch(
      /public_keys\[0\]/
    );
  });
});
