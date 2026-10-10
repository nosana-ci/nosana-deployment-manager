import { describe, it, expect, vi } from "vitest";

import type { OutstandingTasksDocument } from "../../../types/index.js";

vi.mock("../../../config/index.js", () => ({ getConfig: () => ({ confidential_ipfs_pin: "QmConfidential" }) }));

import { resolveListDefinitionHash } from "./resolveDefinitionHash.js";

function makeTask(over: { confidential?: boolean; active_revision?: number }): OutstandingTasksDocument {
  return {
    deploymentId: "dep-1",
    active_revision: over.active_revision,
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

  it("uses the pin of the revision the task lists, never another one's", () => {
    // The deployment moved to revision 2 after this task froze revision 1.
    expect(resolveListDefinitionHash(makeTask({ active_revision: 1 }))).toBe("QmRev1");
  });

  it("fails when the active revision is missing", () => {
    const task = makeTask({});
    task.deployment.active_revision = 9;

    expect(() => resolveListDefinitionHash(task)).toThrow("Active revision not found");
  });
});
