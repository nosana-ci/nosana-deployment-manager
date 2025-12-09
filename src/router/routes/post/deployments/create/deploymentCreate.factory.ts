import { generateKeyPairSigner } from "@solana/signers";
import { createHash, getExposeIdHash } from "@nosana/kit";
import type { JobDefinition, OperationArgsMap } from "@nosana/kit";

import { getKit } from "../../../../../kit/index.js";
import { getConfig } from "../../../../../config/index.js";
import { DeploymentCreateBody } from "../../../../schema/post/index.schema.js";

import {
  DeploymentStatus,
  DeploymentStrategy,
  type Endpoint,
  type RevisionDocument,
  type DeploymentDocument,
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
          url: `https://${getExposeIdHash(deploymentHash, op.id, 0)}.${getConfig().frps_address}`,
        });
      }

      if (Array.isArray(expose)) {
        for (const service of expose) {
          // @ts-expect-error - service can be string or number
          const port = typeof service === "object" ? service.port : service;

          endpoints.push({
            opId: op.id,
            port,
            url: `https://${getExposeIdHash(deploymentHash, op.id, 0)}.${getConfig().frps_address}`,
          });
        }
      }
    }
  }

  return endpoints;
}

export async function createNewDeploymentRevision(
  currentRevision: number,
  deployment: string,
  vault: string,
  jobDefinition: JobDefinition
): Promise<{ revision: RevisionDocument, endpoints: Endpoint[] }> {
  const kit = getKit();

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

  const newIpfsHash = await kit.ipfs.pin(finalJobDefinition);

  return {
    revision: {
      revision: currentRevision + 1,
      deployment: deployment,
      ipfs_definition_hash: newIpfsHash,
      job_definition: finalJobDefinition,
      created_at: new Date(),
    }, endpoints,
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
    rotation_time
  }: DeploymentCreateBody,
  vault: string,
  owner: string,
  created_at: Date
): Promise<{ deployment: DeploymentDocument, revision: RevisionDocument }> {
  const { address } = await generateKeyPairSigner();

  const baseFields = {
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

  const { revision, endpoints } = await createNewDeploymentRevision(
    0,
    baseFields.id,
    vault,
    job_definition as JobDefinition
  );

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
        rotation_time: rotation_time ?? timeout - getConfig().default_seconds_before_timeout,
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
