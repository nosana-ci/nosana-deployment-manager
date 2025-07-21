import { defaultConfig } from "./defaultConfig";

import { DeploymentsConfig } from "../types";

export function getConfig(): DeploymentsConfig {
  return defaultConfig[process.env.NETWORK ?? "mainnet"];
}
