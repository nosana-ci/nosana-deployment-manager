import { generateKeyPairSigner } from "@solana/signers";
import { createHash, getExposeIdHash } from "@nosana/kit";
import type { JobDefinition, OperationArgsMap } from "@nosana/kit";

import { getKit } from "../../../../../kit/index.js";
import { getConfig } from "../../../../../config/index.js";
import { extractSsh, injectSsh } from "../../../../../ssh/index.js";
import { DeploymentCreateBody } from "../../../../schema/post/index.schema.js";

import {
  DeploymentStatus,
  DeploymentStrategy,
  type Endpoint,
  type RevisionDocument,
  type DeploymentDocument,
  type DeploymentDocumentBase,
} from "../../../../../types/index.js";

export function createDeploymentRevisionEndpoints(
  deployment: string,
  vault: string,
  jobDefinition: JobDefinition
) {
  const endpoints: Endpoint[] = [];
  const deploymentHash = createHash(`${deployment}:${vault}`, 45);

  for (const op of jobDefinition.ops) {
    if (op.type === "container/run") {
      const { expose } = op.args as OperationArgsMap["container/run"];

      if (!expose) continue;

      if (typeof expose === "number" || typeof expose === "string") {
        endpoints.push({
          opId: op.id,
          port: expose,
          url: `https://${getExposeIdHash(deploymentHash, op.id, 0)}.${getConfig().frps_public_address}`,
        });
      }

      if (Array.isArray(expose)) {
        for (const service of expose) {
          // @ts-expect-error - Runtime type narrowing, service.port exists when service is an object
          const port = typeof service === "object" ? service.port : service;

          // Skip if port is undefined or null
          if (port === undefined || port === null) {
            continue;
          }

          endpoints.push({
            opId: op.id,
            port,
            url: `https://${getExposeIdHash(deploymentHash, op.id, 0)}.${getConfig().frps_public_address}`,
          });
        }
      }
    }
  }

  return endpoints;
}

/**
 * Whether any `container/run` op exposes a port, i.e. whether this definition can
 * ever produce an FRPS tunnel. `startup_timeout` is meaningless without one — the
 * job could never report that it came online — so creation rejects the pair.
 *
 * Only presence is checked; the shape of each entry is the job definition
 * validation's job.
 */
export function hasExposedPorts(jobDefinition: JobDefinition): boolean {
  return jobDefinition.ops.some((op) => {
    if (op.type !== "container/run") return false;

    const { expose } = op.args as OperationArgsMap["container/run"];

    return Array.isArray(expose) ? expose.length > 0 : expose !== undefined && expose !== null;
  });
}

/**
 * Build the next revision. Any `ssh` block on the submitted definition is split
 * off and handed back as `ssh_public_keys` for the caller to store on the
 * deployment — the revision's `job_definition` never carries keys, so rotating
 * them later doesn't create a revision. For a NON-confidential deployment the
 * revision's PIN does carry them: what gets pinned (and later posted by LIST)
 * is the definition with the effective keys merged in. A confidential
 * deployment's pin stays key-free — nothing of its definition may live on
 * public IPFS; nodes get definition + keys from the authenticated
 * job-definition route instead. `currentPublicKeys` is the deployment's
 * existing set, kept when the submitted definition doesn't mention keys.
 */
export async function createNewDeploymentRevision(
  currentRevision: number,
  deployment: string,
  vault: string,
  submittedJobDefinition: JobDefinition,
  options: { confidential: boolean; currentPublicKeys?: string[] }
): Promise<{ revision: RevisionDocument, endpoints: Endpoint[], ssh_public_keys?: string[] }> {
  const kit = getKit();
  const { jobDefinition, public_keys = options.currentPublicKeys } = extractSsh(submittedJobDefinition);

  const endpoints: Endpoint[] = createDeploymentRevisionEndpoints(
    deployment,
    vault,
    jobDefinition
  );

  const finalJobDefinition: JobDefinition = {
    ...jobDefinition,
    deployment_id: deployment,
    meta: {
      ...jobDefinition.meta,
      trigger: "deployment-manager",
    },
  }

  const ssh_public_keys = public_keys?.length ? public_keys : undefined;
  const newIpfsHash = await kit.ipfs.pin(
    options.confidential ? finalJobDefinition : injectSsh(finalJobDefinition, ssh_public_keys)
  );

  return {
    revision: {
      revision: currentRevision + 1,
      deployment: deployment,
      ipfs_definition_hash: newIpfsHash,
      job_definition: finalJobDefinition,
      created_at: new Date(),
    }, endpoints,
    ssh_public_keys,
  };
}

export async function createDeployment(
  {
    name,
    market,
    job_definition,
    replicas,
    strategy,
    schedule,
    confidential,
    timeout,
    rotation_time,
    startup_timeout,
    ssh_public_keys
  }: DeploymentCreateBody,
  vault: string,
  owner: string,
  created_at: Date
): Promise<{ deployment: DeploymentDocument, revision: RevisionDocument }> {
  const { address } = await generateKeyPairSigner();

  const baseFields: Omit<DeploymentDocumentBase, "endpoints"> = {
    id: address.toString(),
    vault,
    name,
    market: market.trim(),
    owner,
    status: DeploymentStatus.DRAFT,
    replicas,
    timeout,
    active_revision: 1,
    confidential: confidential ?? getConfig().confidential_by_default,
    created_at,
    updated_at: created_at,
  };

  const { revision, endpoints, ssh_public_keys: storedPublicKeys } = await createNewDeploymentRevision(
    0,
    baseFields.id,
    vault,
    // Top-level keys are authoritative: injecting them replaces any `ssh`
    // block embedded in the submitted definition before the split.
    ssh_public_keys
      ? injectSsh(job_definition as JobDefinition, ssh_public_keys)
      : (job_definition as JobDefinition),
    { confidential: baseFields.confidential }
  );
  if (storedPublicKeys) baseFields.ssh_public_keys = storedPublicKeys;

  if (strategy === DeploymentStrategy.SCHEDULED) {
    if (!schedule) {
      throw new Error("Schedule must be provided for scheduled deployments.");
    }
    return {
      deployment: {
        ...baseFields,
        strategy,
        schedule,
        endpoints
      }, revision
    };
  }

  if (strategy === DeploymentStrategy.INFINITE) {
    return {
      deployment: {
        ...baseFields,
        strategy,
        timeout,
        rotation_time: rotation_time ?? getConfig().default_minutes_before_timeout,
        ...(startup_timeout !== undefined && { startup_timeout }),
        endpoints
      }, revision
    };
  }

  return {
    deployment: {
      ...baseFields,
      strategy,
      endpoints
    }, revision
  };
}
