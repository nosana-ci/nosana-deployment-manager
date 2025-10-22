import { Db } from "mongodb";

import { DeploymentDocument } from "../../../types/index.js";
import { createNewDeploymentRevision } from "../../../router/routes/post/deployments/create/deploymentCreate.factory.js";
import { getSdk } from "../../../sdk/index.js";

type OldDeploymentDocument = Omit<DeploymentDocument, "active_revision"> & {
  ipfs_definition_hash: string;
};

export default async function migrateDeploymentsToEndpoints(db: Db) {
  const sdk = await getSdk();
  const deployments = await db.collection<OldDeploymentDocument>("deployments").find({
    active_revision: { $exists: false }, ipfs_definition_hash: { $exists: true }
  }).toArray();

  for (const { ipfs_definition_hash, ...deploymentWithIPFSHash } of deployments) {
    const jobDefinition = await sdk.ipfs.retrieve(ipfs_definition_hash);
    const { revision } = await createNewDeploymentRevision(0, deploymentWithIPFSHash.id, deploymentWithIPFSHash.vault, jobDefinition);

    const { acknowledged: revisionAcknowledged } = await db.collection("revisions").insertOne(revision);

    if (!revisionAcknowledged) {
      console.error(`Failed to create deployment revision for deployment ${deploymentWithIPFSHash.id}`);
      continue;
    }

    const updatedDeployment = {
      ...deploymentWithIPFSHash,
      active_revision: revision.revision,
      updated_at: new Date(),
    };

    const { acknowledged } = await db.collection("deployments").updateOne(
      { id: deploymentWithIPFSHash.id },
      { $set: updatedDeployment, $unset: { ipfs_definition_hash: "" } }
    );

    if (!acknowledged) {
      console.error(`Failed to update deployment ${deploymentWithIPFSHash.id}`);
      continue;
    }
  }
}
