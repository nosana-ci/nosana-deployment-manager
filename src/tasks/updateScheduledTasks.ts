import type { Db } from "mongodb";

import { TaskType } from "../types/index.js";
import type { TaskDocument, TasksCollection } from "../types/index.js";

/**
 * Moves a SCHEDULED deployment's pending cron LISTs to the new schedule's next
 * firing. Only LISTs follow the cron: a STOP (or anything else) keeps its time.
 */
export async function updateScheduledTasks(db: Db, deploymentId: string, due_at: Date) {
  const tasks: TasksCollection = db.collection<TaskDocument>("tasks");

  const { acknowledged } = await tasks.updateMany(
    {
      deploymentId: {
        $eq: deploymentId
      },
      task: TaskType.LIST,
      tx: { $eq: null }
    },
    { $set: { due_at } }
  );

  if (!acknowledged) {
    console.error(
      `Failed to update scheduled tasks for deployment ${deploymentId}.`
    );
  }
}