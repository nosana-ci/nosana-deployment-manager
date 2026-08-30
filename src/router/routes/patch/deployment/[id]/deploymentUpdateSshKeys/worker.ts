import { parentPort, workerData } from "worker_threads";

import { prepareWorker, signAuthHeader, workerErrorFormatter } from "../../../../../../worker/Worker.js";
import { pushSshKeysToNode, type SignSshAuthorizationMessage } from "../../../../../../ssh/index.js";

import type { JobSshKeysResult } from "../../../../../schema/patch/deployments/[id]/deploymentUpdateSshKeys.schema.js";

export type SshKeysWorkerData = {
  vault: string;
  public_keys: string[];
  jobs: Array<{ job: string; node: string }>;
};

export type SshKeysWorkerMessage =
  | { event: "PUSHED"; results: JobSshKeysResult[] }
  | { event: "ERROR"; error: string };

/**
 * Message signed into the request's `authorization` header. Its content isn't
 * checked node-side (only the signer and freshness are), so we reuse the same
 * generic owner-header message the node's other job-owner routes accept.
 */
const OWNER_AUTH_MESSAGE = "DEPLOYMENT_HEADER";

/**
 * Grants a deployment's new keys SSH access on the node of each running job.
 * Runs in a worker because that is where the vault key is decrypted. Each
 * authorize call carries two poster-signed proofs: the body message (bound to
 * the specific key, with no timestamp — the node verifies exactly
 * `<message>:<signature>`), and the standard job-owner `authorization` header
 * (the same signer behind `GET /deployments/:id/header`, timestamped so the
 * node's middleware authenticates the request). Both are verified against
 * `job.project`; one header serves every job in the rotation.
 */
try {
  const { kit, useNosanaApiKey, public_keys, jobs } =
    await prepareWorker<SshKeysWorkerData>(workerData);

  const sign: SignSshAuthorizationMessage = (message) =>
    signAuthHeader(kit, useNosanaApiKey, message, { includeTime: false });

  const authHeader = await signAuthHeader(kit, useNosanaApiKey, OWNER_AUTH_MESSAGE, {
    includeTime: true,
  });

  const results: JobSshKeysResult[] = await Promise.all(
    jobs.map(async ({ job, node }): Promise<JobSshKeysResult> => {
      try {
        const result = await pushSshKeysToNode({ node, job, public_keys, sign, authHeader });
        return result.ok
          ? { job, node, status: "authorized" }
          : { job, node, status: "failed", error: result.error };
      } catch (error) {
        return { job, node, status: "failed", error: workerErrorFormatter(error) };
      }
    })
  );

  parentPort!.postMessage({ event: "PUSHED", results } satisfies SshKeysWorkerMessage);
} catch (error) {
  parentPort!.postMessage({
    event: "ERROR",
    error: workerErrorFormatter(error),
  } satisfies SshKeysWorkerMessage);
}
