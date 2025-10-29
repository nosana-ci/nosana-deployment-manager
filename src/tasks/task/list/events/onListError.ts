import { OnListEventParams } from "../spawner.js";

import { DeploymentStatus } from "../../../../types/index.js";

export function onListError(
  tx: string | undefined,
  error: string | null | undefined,
  { collections: { events }, task, setErrorType }: OnListEventParams
) {
  if (!error || error === null) return;

  events.insertOne({
    deploymentId: task.deploymentId,
    category: "Deployment",
    type: "JOB_LIST_ERROR",
    tx,
    message: error,
    created_at: new Date(),
  });

  setErrorType(error.includes("InsufficientFundsForRent") ? DeploymentStatus.INSUFFICIENT_FUNDS : DeploymentStatus.ERROR);
}
