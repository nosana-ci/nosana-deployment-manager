import { Db } from "mongodb";

import { startDeploymentCollectionListener } from "./deployments/index.js";
import { startJobAccountsListeners } from "./accounts/index.js";
import { startJobsCollectionListener } from "./jobs/index.js";
import { startFrpsListener } from "./frps/index.js";

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
  const frps = await startFrpsListener(db);

  return {
    stop: async () => {
      // Stop the producers that schedule work (the RPC monitor and the FRPS
      // event stream) before closing the change streams. The FRPS stop flushes
      // its resume cursor, so await it.
      accounts.stop();
      await frps.stop();
      await Promise.all([deployments.stop(), jobs.stop()]);
    },
  };
}
