import { defaultConfig } from "./defaultConfig.js";

import { DeploymentsConfig } from "../types/index.js";

let configOverrides: Partial<DeploymentsConfig> = {};

export function getConfig(): DeploymentsConfig {
  const baseConfig = defaultConfig[process.env.NETWORK ?? "mainnet"];
  return { ...baseConfig, ...configOverrides };

}

export function setConfig<K extends keyof DeploymentsConfig>(key: K, value: DeploymentsConfig[K]): void {
  configOverrides[key] = value;
}
