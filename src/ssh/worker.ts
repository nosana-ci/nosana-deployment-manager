import { parentPort, workerData } from "worker_threads";

import { prepareWorker, workerErrorFormatter } from "../worker/Worker.js";

import type { JobSshKeysResult } from "../router/schema/components/ssh.schema.js";

export type SshKeysOperation = "authorize" | "revoke";

export type SshKeysWorkerData = {
  vault: string;
  operation: SshKeysOperation;
  /** The keys to grant (authorize) or remove (revoke) on each running job. */
  public_keys: string[];
  jobs: Array<{ job: string; node: string }>;
};

export type SshKeysWorkerMessage =
  | { event: "PUSHED"; results: JobSshKeysResult[] }
  | { event: "ERROR"; error: string };

/** Per-request budget; a dead node must not hold the whole rotation hostage. */
const NODE_REQUEST_TIMEOUT_MS = 10_000;

/**
 * Applies a deployment's SSH key change to each of its running jobs through
 * the kit: `jobs.get(address)` finds the job's node and signs every request as the
 * job owner, which is why this runs in a worker — that is where the vault key
 * is decrypted. The node takes one key per call. Each job is reported
 * individually so an unreachable node cannot fail (or roll back) the change.
 */
try {
  const { kit, operation, public_keys, jobs } = await prepareWorker<SshKeysWorkerData>(workerData);
  const status: JobSshKeysResult["status"] = operation === "revoke" ? "revoked" : "authorized";

  const results = await Promise.all(
    jobs.map(async ({ job, node }): Promise<JobSshKeysResult> => {
      try {
        const { ssh } = await kit.api.jobs.get(job);
        for (const key of public_keys) {
          const options = { signal: AbortSignal.timeout(NODE_REQUEST_TIMEOUT_MS) };
          await (operation === "revoke" ? ssh.remove(key, options) : ssh.add(key, options));
        }
        return { job, node, status };
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
