import { Collection, ObjectId } from "mongodb";

import { OutstandingTasksDocument, TaskDocument } from "../types/index.js";

export async function getOutstandingTasks(
  collection: Collection<TaskDocument>,
  keys: ObjectId[],
  batchSize: number
): Promise<OutstandingTasksDocument[]> {
  return collection
    .aggregate()
    .match({
      due_at: {
        $lt: new Date(),
      },
      _id: {
        $nin: keys,
      },
    })
    .limit(batchSize - keys.length)
    .lookup({
      from: "deployments",
      localField: "deploymentId",
      foreignField: "id",
      as: "deployment",
    })
    .lookup({
      from: "jobs",
      localField: "deploymentId",
      foreignField: "deployment",
      pipeline: [
        {
          $match: {
            status: "PENDING"
          }
        }
      ],
      as: "jobs",
    })
    .unwind({
      path: "$deployment",
      preserveNullAndEmptyArrays: false,
    })
    .lookup({
      from: "vaults",
      localField: "deployment.vault",
      foreignField: "vault",
      as: "deployment.vault",
    })
    .lookup({
      from: "revisions",
      localField: "deploymentId",
      foreignField: "deployment",
      as: "revisions",
    })
    .unwind({
      path: "$deployment.vault",
      preserveNullAndEmptyArrays: false,
    })
    .toArray() as Promise<OutstandingTasksDocument[]>;
}
