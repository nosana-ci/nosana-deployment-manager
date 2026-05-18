import { Db } from "mongodb";

import { startDeploymentCollectionListener } from "./deployments/index.js";
import { startTaskCollectionListener } from "../tasks/index.js";
import { startJobAccountsListeners } from "./accounts/index.js";
import { startJobsCollectionListener } from "./jobs/index.js";

export type DeploymentManagerListenersHandle = {
  stop: () => Promise<void>;
};

export async function startDeploymentManagerListeners(
  db: Db,
): Promise<DeploymentManagerListenersHandle> {
  const deployments = startDeploymentCollectionListener(db);
  const jobs = startJobsCollectionListener(db);
  const tasks = startTaskCollectionListener(db);
  const accounts = await startJobAccountsListeners(db);

  return {
    stop: async () => {
      // Stop scheduling new work first (tasks polling, RPC monitor),
      // then close the change streams.
      const stopTasks = Promise.resolve(tasks.stop());
      accounts.stop();
      await stopTasks;
      await Promise.all([deployments.stop(), jobs.stop()]);
    },
  };
}
