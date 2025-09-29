import solana from "@solana/web3.js";
import {
  Client,
  createHash,
  getExposeIdHash,
  JobDefinition,
  OperationArgsMap,
} from "@nosana/sdk";

import { getConfig } from "../../../../../config/index.js";
import { DeploymentCreateBody } from "../../../../schema/post/index.schema.js";

import {
  type DeploymentDocument,
  DeploymentStatus,
  DeploymentStrategy,
  type Endpoint,
} from "../../../../../types/index.js";

async function createDeploymentEndpoints(
  deployment: string,
  vault: string,
  ipfs_definition_hash: string
): Promise<{ endpoints: Endpoint[]; newIpfsHash: string }> {
  const endpoints: Endpoint[] = [];
  const client = new Client(getConfig().network);
  const deploymentHash = createHash(`${deployment}:${vault}`, 45);

  let jobDefinition: JobDefinition = await client.ipfs.retrieve(
    ipfs_definition_hash
  );

  jobDefinition.deployment_id = deployment;

  const newIpfsHash = await client.ipfs.pin({
    ...jobDefinition,
    deployment_id: deployment,
    meta: {
      ...jobDefinition.meta,
      trigger: "deployment-manager",
    },
  });

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

  return { endpoints, newIpfsHash };
}

export async function createDeployment(
  {
    name,
    market,
    ipfs_definition_hash,
    replicas,
    strategy,
    schedule,
    timeout,
  }: DeploymentCreateBody,
  vault: string,
  owner: string,
  created_at: Date
): Promise<DeploymentDocument> {
  const baseFields = {
    id: solana.Keypair.generate().publicKey.toString(),
    vault,
    name,
    market,
    owner,
    status: DeploymentStatus.DRAFT,
    ipfs_definition_hash,
    replicas,
    timeout,
    created_at,
    updated_at: created_at,
  };

  const { endpoints, newIpfsHash } = await createDeploymentEndpoints(
    baseFields.id,
    vault,
    ipfs_definition_hash
  );

  baseFields.ipfs_definition_hash = newIpfsHash;

  if (strategy === DeploymentStrategy.SCHEDULED) {
    return {
      ...baseFields,
      strategy,
      schedule,
      endpoints,
    };
  }

  return {
    ...baseFields,
    strategy,
    endpoints,
  };
}
