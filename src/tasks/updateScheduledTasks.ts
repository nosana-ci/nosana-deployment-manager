import type { Db } from "mongodb";
import type { TaskDocument, TasksCollection } from "../types";

export async function updateScheduledTasks(db: Db, deploymentId: string, due_at: Date) {
  const tasks: TasksCollection = db.collection<TaskDocument>("tasks");

  const { acknowledged } = await tasks.updateMany(
    {
      deploymentId: {
        $eq: deploymentId
      },
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