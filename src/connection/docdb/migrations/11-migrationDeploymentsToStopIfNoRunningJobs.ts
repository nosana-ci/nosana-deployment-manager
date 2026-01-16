import { Db } from "mongodb";
import { DeploymentStatus } from "@nosana/kit";

import { NosanaCollections } from "../../../definitions/collection.js";
import { DeploymentDocument, JobsDocument, JobState, TaskDocument } from "../../../types/index.js";

export default async function migrateJobsToMarket(db: Db) {
  const deploymentsCollection = db.collection<DeploymentDocument>(NosanaCollections.DEPLOYMENTS);
  const jobsCollection = db.collection<JobsDocument>(NosanaCollections.JOBS);
  const tasksCollection = db.collection<TaskDocument>(NosanaCollections.TASKS);

  const activeDeployments = await deploymentsCollection.find({ status: DeploymentStatus.RUNNING }).toArray();

  for (const deployment of activeDeployments) {
    const [runningJobsCount, tasksCount] = await Promise.all([jobsCollection.countDocuments({
      deploymentId: deployment._id,
      state: { $in: [JobState.QUEUED, JobState.RUNNING] },
    }), await tasksCollection.countDocuments({
      deployment_id: deployment._id,
    })]);

    if (runningJobsCount === 0 && tasksCount === 0) {
      await deploymentsCollection.updateOne(
        { _id: deployment._id },
        { $set: { status: DeploymentStatus.STOPPING } }
      );
    }
  }
}