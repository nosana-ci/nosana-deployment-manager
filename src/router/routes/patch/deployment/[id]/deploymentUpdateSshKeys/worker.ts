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
 * Grants a deployment's new keys SSH access on the node of each running job.
 * Runs in a worker because that is where the vault key is decrypted: every
 * authorize call carries a message signed by the job's poster (the vault),
 * which the node verifies against `job.project`. The signed string is the
 * untouched `signAuthHeader` output (the same signer behind
 * `GET /deployments/:id/header`), with no timestamp appended — the node
 * verifies exactly `<message>:<signature>`.
 */
try {
  const { kit, useNosanaApiKey, public_keys, jobs } =
    await prepareWorker<SshKeysWorkerData>(workerData);

  const sign: SignSshAuthorizationMessage = (message) =>
    signAuthHeader(kit, useNosanaApiKey, message, { includeTime: false });

  const results: JobSshKeysResult[] = await Promise.all(
    jobs.map(async ({ job, node }): Promise<JobSshKeysResult> => {
      try {
        const result = await pushSshKeysToNode({ node, job, public_keys, sign });
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
