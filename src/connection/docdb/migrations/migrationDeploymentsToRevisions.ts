import { Db } from "mongodb";
import { DeploymentStatus, JobDefinition } from "@nosana/kit";

import { getKit } from "../../../kit/index.js";
import { createNewDeploymentRevision } from "../../../router/routes/post/deployments/create/deploymentCreate.factory.js";

import { DeploymentDocument, EventDocument, EventType } from "../../../types/index.js";

type OldDeploymentDocument = Omit<DeploymentDocument, "active_revision"> & {
  ipfs_definition_hash: string;
};

export default async function migrateDeploymentsToEndpoints(db: Db) {
  const kit = await getKit();
  const deployments = await db.collection<OldDeploymentDocument>("deployments").find({
    active_revision: { $exists: false }, ipfs_definition_hash: { $exists: true }
  }).toArray();

  for (const { ipfs_definition_hash, ...deploymentWithIPFSHash } of deployments) {
    try {
      const jobDefinition = await kit.ipfs.retrieve<JobDefinition>(ipfs_definition_hash);
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
    } catch (error) {
      await db.collection("deployments").updateOne(
        { id: deploymentWithIPFSHash.id },
        {
          $set: {
            status: DeploymentStatus.ERROR, active_revision: 0, updated_at: new Date(),
          }, $unset: { ipfs_definition_hash: "" }
        }
      );

      db.collection<EventDocument>("events").insertOne({
        category: EventType.DEPLOYMENT,
        deploymentId: deploymentWithIPFSHash.id,
        type: "MIGRATION_ERROR",
        message: `Error processing deployment ${deploymentWithIPFSHash.id}: ${(error as Error).message}`,
        created_at: new Date(),
      });

      console.error(`Error processing deployment ${deploymentWithIPFSHash.id}:`, error);
    }
  }
}
