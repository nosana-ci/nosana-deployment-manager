import { describe, it, expect, vi } from "vitest";

import type { OutstandingTasksDocument } from "../../../types/index.js";

vi.mock("../../../config/index.js", () => ({ getConfig: () => ({ confidential_ipfs_pin: "QmConfidential" }) }));

import { resolveListDefinitionHash } from "./resolveDefinitionHash.js";

function makeTask(over: { confidential?: boolean }): OutstandingTasksDocument {
  return {
    deploymentId: "dep-1",
    deployment: { confidential: over.confidential ?? false, active_revision: 2 },
    revisions: [
      { revision: 1, ipfs_definition_hash: "QmRev1" },
      { revision: 2, ipfs_definition_hash: "QmRev2" },
    ],
  } as unknown as OutstandingTasksDocument;
}

describe("resolveListDefinitionHash", () => {
  it("uses the confidential placeholder pin for confidential deployments", () => {
    expect(resolveListDefinitionHash(makeTask({ confidential: true }))).toBe("QmConfidential");
  });

  it("uses the active revision's pin (which already embeds any SSH keys)", () => {
    expect(resolveListDefinitionHash(makeTask({}))).toBe("QmRev2");
  });

  it("fails when the active revision is missing", () => {
    const task = makeTask({});
    task.deployment.active_revision = 9;

    expect(() => resolveListDefinitionHash(task)).toThrow("Active revision not found");
  });
});
