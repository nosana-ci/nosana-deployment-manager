import { OnListEventParams } from "../spawner.js";

import { DeploymentStatus } from "../../../../types/index.js";

export function onListError(
  tx: string | undefined,
  error: string | undefined,
  { collections: { events }, task, setDeploymentErrorStatus }: OnListEventParams
) {
  if (!error) return;

  events.insertOne({
    deploymentId: task.deploymentId,
    category: "Deployment",
    type: "JOB_LIST_ERROR",
    tx,
    message: error,
    created_at: new Date(),
  });

  setDeploymentErrorStatus(error.includes("InsufficientFundsForRent") ? DeploymentStatus.INSUFFICIENT_FUNDS : DeploymentStatus.ERROR);
}
