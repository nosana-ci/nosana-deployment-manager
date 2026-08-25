import type { RouteHandler } from "fastify";

import { ErrorMessages } from "../../../../../../errors/index.js";
import { getKit } from "../../../../../../kit/index.js";
import { VaultWorker } from "../../../../../../worker/Worker.js";
import { injectSsh, validateSshPublicKeys } from "../../../../../../ssh/index.js";
import { JobState } from "../../../../../../types/index.js";

import type { HeadersSchema } from "../../../../../schema/index.schema.js";
import type {
  DeploymentUpdateSshKeysBody,
  DeploymentUpdateSshKeysError,
  DeploymentUpdateSshKeysSuccess,
  JobSshKeysResult,
} from "../../../../../schema/patch/index.schema.js";
import type { SshKeysWorkerData, SshKeysWorkerMessage } from "./worker.js";

function pushKeysToRunningJobs(data: SshKeysWorkerData): Promise<JobSshKeysResult[]> {
  return new Promise((resolve, reject) => {
    const worker = new VaultWorker<SshKeysWorkerData>(
      "../router/routes/patch/deployment/[id]/deploymentUpdateSshKeys/worker.js",
      { workerData: data }
    );

    worker.on("message", (message: SshKeysWorkerMessage) => {
      switch (message.event) {
        case "PUSHED":
          resolve(message.results);
          break;
        case "ERROR":
          reject(new Error(message.error));
          break;
        default:
          reject(new Error("Unknown event from worker"));
      }
    });
    worker.on("error", reject);
  });
}

/**
 * Rotate a deployment's SSH keys in one call. The set is stored on the
 * deployment — not on a revision, so nothing is redeployed — and from here on
 * is injected into every job posted. Jobs already running are reached through
 * their node's authorize route; each job is reported individually in `jobs`,
 * so a single unreachable node can't fail (or roll back) the rotation.
 */
export const deploymentUpdateSshKeysHandler: RouteHandler<{
  Body: DeploymentUpdateSshKeysBody;
  Params: { deployment: string };
  Headers: HeadersSchema;
  Reply: DeploymentUpdateSshKeysSuccess | DeploymentUpdateSshKeysError;
}> = async (req, res) => {
  const { db } = res.locals;
  const { vault, confidential, id, active_revision } = res.locals.deployment!;
  const owner = req.headers["x-user-id"];
  const public_keys = req.body.public_keys.map((key) => key.trim());

  const invalid = validateSshPublicKeys(public_keys);
  if (invalid) {
    res.status(400).send({ error: invalid });
    return;
  }

  try {
    const vaultDocument = await db.vaults.findOne({ vault, owner });
    if (!vaultDocument) {
      res.status(500).send({ error: ErrorMessages.vaults.FAILED_TO_FIND_KEY });
      return;
    }

    const ssh_public_keys = public_keys.length > 0 ? public_keys : undefined;
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
      {
        id: { $eq: id },
        owner: { $eq: owner },
      },
      ssh_public_keys
        ? { $set: { ssh_public_keys, updated_at } }
        : { $set: { updated_at }, $unset: { ssh_public_keys: "" } }
    );

    if (!acknowledged) {
      res.status(500).send({ error: ErrorMessages.deployments.FAILED_TO_UPDATE_SSH_KEYS });
      return;
    }

    // The node's only SSH route grants keys access — there is no removal call —
    // so a revocation (empty set) has nothing to push: running jobs keep the
    // keys they started with until they stop.
    const running = ssh_public_keys
      ? await db.jobs
        .find(
          { deployment: id, state: JobState.RUNNING, node: { $ne: null } },
          { projection: { job: 1, node: 1 } }
        )
        .toArray()
      : [];

    const jobs: JobSshKeysResult[] =
      running.length === 0
        ? []
        : await pushKeysToRunningJobs({
          vault: vaultDocument.vault_key,
          public_keys: ssh_public_keys ?? [],
          jobs: running.map(({ job, node }) => ({ job, node: node! })),
        });

    const authorized = jobs.filter(({ status }) => status === "authorized").length;
    await db.events.insertOne({
      deploymentId: id,
      category: "Deployment",
      type: "SSH_KEYS_UPDATED",
      message: ssh_public_keys
        ? `SSH keys updated (${ssh_public_keys.length} key(s)); authorized on ${authorized}/${jobs.length} running job(s).`
        : "SSH keys removed; running jobs keep their current keys until they stop.",
      created_at: updated_at,
    });

    res.status(200).send({
      public_keys: ssh_public_keys ?? [],
      updated_at: updated_at.toISOString(),
      jobs,
    });
  } catch (error) {
    res.log.error("Error updating deployment SSH keys: %s", String(error));
    res.status(500).send({ error: ErrorMessages.generic.SOMETHING_WENT_WRONG });
  }
};
