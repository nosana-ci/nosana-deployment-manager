import { createDeepStore } from "deep-context-stores";

import { startDeploymentManagerApi } from "./routes/index.js";
import { defaultConfig } from "./definitions/defaultConfig.js";
import { DeploymentsConnection } from "./connection/deployments.js";
import { startDeploymentManagerListeners } from "./listeners/index.js";

import { DeploymentsConfig } from "./types.js";

export async function startDeploymentManager(
  config?: Partial<DeploymentsConfig>
) {
  const { withStore } = createDeepStore<DeploymentsConfig>(
    Object.assign(defaultConfig[config?.network ?? "mainnet"], config)
  );

  try {
    withStore(async () => {
      const dbClient = await DeploymentsConnection();

      if (!dbClient) {
        throw new Error("Failed to connect to the database");
      }

      startDeploymentManagerListeners(dbClient);
      startDeploymentManagerApi(dbClient);
    });
  } catch (error) {
    throw error;
  }
}

export { Vault } from "./vault/index.js";
