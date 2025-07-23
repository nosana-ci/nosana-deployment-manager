import { defaultConfig } from "./defaultConfig.js";

import { DeploymentsConfig } from "../types.js";

export function getConfig(): DeploymentsConfig {
  return defaultConfig[process.env.NETWORK ?? "mainnet"];
}
