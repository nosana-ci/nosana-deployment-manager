import type { FastifyReply, FastifyRequest } from "fastify";

import { ErrorMessages } from "../errors/index.js";
import { getKit } from "../kit/index.js";
import { VaultWorker } from "../worker/Worker.js";
import { injectSsh } from "./jobDefinition.js";
import { JobState } from "../types/index.js";

import type { JobSshKeysResult } from "../router/schema/components/ssh.schema.js";
import type { SshKeysOperation, SshKeysWorkerData, SshKeysWorkerMessage } from "./worker.js";

function pushToRunningJobs(data: SshKeysWorkerData): Promise<JobSshKeysResult[]> {
  return new Promise((resolve, reject) => {
    const worker = new VaultWorker<SshKeysWorkerData>("../ssh/worker.js", {
      workerData: data,
    });

    worker.on("message", (message: SshKeysWorkerMessage) => {
      if (message.event === "PUSHED") resolve(message.results);
      else if (message.event === "ERROR") reject(new Error(message.error));
      else reject(new Error("Unknown event from worker"));
    });
    worker.on("error", reject);
  });
}

export type CommitSshKeysParams = {
  /** The full key set the deployment should hold after the change. */
  next: string[];
  /** The keys to apply on running jobs: grants for `authorize`, removals for `revoke`. Never empty: a no-op answers before reaching here. */
  delta: string[];
  operation: SshKeysOperation;
  /** Builds the deployment-event message once the per-job outcomes are known. */
  event: (summary: { next: string[]; applied: number; total: number }) => string;
};

/**
 * Persist a deployment's new SSH key set and reconcile it with running jobs.
 * Shared by the add and revoke routes: the set lives on the deployment (not on
 * a revision, so nothing is redeployed) and is injected into every future job;
 * the `delta` is applied to each running job's node and reported per job, so a
 * single unreachable node can't fail (or roll back) the change.
 */
export async function commitDeploymentSshKeys(
  req: FastifyRequest<{ Params: { deployment: string } }>,
  res: FastifyReply,
  { next, delta, operation, event }: CommitSshKeysParams
): Promise<void> {
  const { db } = res.locals;
  const { vault, confidential, id, active_revision } = res.locals.deployment!;
  const owner = req.headers["x-user-id"] as string;

  const vaultDocument = await db.vaults.findOne({ vault, owner });
  if (!vaultDocument) {
    res.status(500).send({ error: ErrorMessages.vaults.FAILED_TO_FIND_KEY });
    return;
  }

  const ssh_public_keys = next.length > 0 ? next : undefined;
  if (!confidential) {
    const revision = await db.revisions.findOne(
      { deployment: id, revision: active_revision },
      { projection: { job_definition: 1 } }
    );
    if (!revision) {
      res.status(500).send({ error: ErrorMessages.deployments.FAILED_TO_UPDATE_SSH_KEYS });
      return;
    }
    const ipfs_definition_hash = await getKit().ipfs.pin(injectSsh(revision.job_definition, ssh_public_keys));
    await db.revisions.updateOne(
      { deployment: id, revision: active_revision },
      { $set: { ipfs_definition_hash } }
    );
  }

  const updated_at = new Date();
  const { acknowledged } = await db.deployments.updateOne(
    { id: { $eq: id }, owner: { $eq: owner } },
    ssh_public_keys
      ? { $set: { ssh_public_keys, updated_at } }
      : { $set: { updated_at }, $unset: { ssh_public_keys: "" } }
  );
  if (!acknowledged) {
    res.status(500).send({ error: ErrorMessages.deployments.FAILED_TO_UPDATE_SSH_KEYS });
    return;
  }

  const running = await db.jobs
    .find(
      { deployment: id, state: JobState.RUNNING, node: { $ne: null } },
      { projection: { job: 1, node: 1 } }
    )
    .toArray();

  const jobs: JobSshKeysResult[] =
    running.length === 0
      ? []
      : await pushToRunningJobs({
          vault: vaultDocument.vault_key,
          operation,
          public_keys: delta,
          jobs: running.map(({ job, node }) => ({ job, node: node! })),
        });

  const applied = jobs.filter(({ status }) => status !== "failed").length;
  await db.events.insertOne({
    deploymentId: id,
    category: "Deployment",
    type: "SSH_KEYS_UPDATED",
    message: event({ next, applied, total: jobs.length }),
    created_at: updated_at,
  });

  res.status(200).send({
    public_keys: next,
    updated_at: updated_at.toISOString(),
    jobs,
  });
}
