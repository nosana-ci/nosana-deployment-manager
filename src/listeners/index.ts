import { Db } from "mongodb";

import { startDeploymentCollectionListener } from "./deployments/index.js";
import { startJobAccountsListeners } from "./accounts/index.js";
import { startJobsCollectionListener } from "./jobs/index.js";

export type DeploymentManagerListenersHandle = {
  stop: () => Promise<void>;
};

/**
 * Starts the singleton producer side: the deployment/jobs change streams and
 * the Solana account monitor. These schedule tasks into the `tasks` collection;
 * the (separately scalable) consumer claims them. See {@link shouldRunListeners}.
 */
export async function startDeploymentManagerListeners(
  db: Db,
): Promise<DeploymentManagerListenersHandle> {
  const deployments = startDeploymentCollectionListener(db);
  const jobs = startJobsCollectionListener(db);
  const accounts = await startJobAccountsListeners(db);

  return {
    stop: async () => {
      // Stop the RPC monitor (which schedules work) before closing the
      // change streams.
      accounts.stop();
      await Promise.all([deployments.stop(), jobs.stop()]);
    },
  };
}
