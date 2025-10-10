import solana from "@solana/web3.js";
import {
  createHash,
  getExposeIdHash,
  JobDefinition,
  OperationArgsMap,
} from "@nosana/sdk";

import { getSdk } from "../../../../../sdk/index.js";
import { getConfig } from "../../../../../config/index.js";
import { DeploymentCreateBody } from "../../../../schema/post/index.schema.js";

import {
  type DeploymentDocument,
  DeploymentStatus,
  DeploymentStrategy,
  type Endpoint,
  type RevisionDocument,
} from "../../../../../types/index.js";

export async function createNewDeploymentRevision(
  currentRevision: number,
  deployment: string,
  vault: string,
  jobDefinition: JobDefinition
): Promise<{ revision: RevisionDocument, endpoints: Endpoint[] }> {
  const client = getSdk();

  const endpoints: Endpoint[] = [];
  const deploymentHash = createHash(`${deployment}:${vault}`, 45);

  const finalJobDefinition: JobDefinition = {
    ...jobDefinition,
    deployment_id: deployment,
    meta: {
      ...jobDefinition.meta,
      trigger: "deployment-manager",
    },
  }

  const newIpfsHash = await client.ipfs.pin(finalJobDefinition);

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
    timeout,
  }: DeploymentCreateBody,
  vault: string,
  owner: string,
  created_at: Date
): Promise<{ deployment: DeploymentDocument, revision: RevisionDocument }> {
  const baseFields = {
    id: solana.Keypair.generate().publicKey.toString(),
    vault,
    name,
    market,
    owner,
    status: DeploymentStatus.DRAFT,
    replicas,
    timeout,
    active_revision: 1,
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
    return {
      deployment: {
        ...baseFields,
        strategy,
        schedule,
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
