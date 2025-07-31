import { defaultConfig } from "./defaultConfig.js";

import { DeploymentsConfig } from "../types/index.js";

export function getConfig(): DeploymentsConfig {
  return defaultConfig[process.env.NETWORK ?? "mainnet"];
}
