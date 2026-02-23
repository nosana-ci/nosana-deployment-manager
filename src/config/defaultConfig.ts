import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { DeploymentsConfig } from "../types/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const commonConfig: Omit<
  DeploymentsConfig,
  | "network"
  | "nos_address"
  | "rpc_network"
  | "frps_address"
  | "dashboard_backend_url"
  | "client_manager_url"
> = {
  tasks_batch_size: process.env.TASKS_BATCH_SIZE
    ? parseInt(process.env.TASKS_BATCH_SIZE)
    : 10,
  deployment_manager_port: process.env.DEPLOYMENT_MANAGER_PORT
    ? parseInt(process.env.DEPLOYMENT_MANAGER_PORT)
    : 3001,
  confidential_by_default: process.env.CONFIDENTIAL_BY_DEFAULT === "true",
  vault_key: process.env.VAULT_KEY || undefined,
  confidential_ipfs_pin: "",
  base_url:
    process.env.BASE_URL ||
    `http://localhost:${process.env.DEPLOYMENT_MANAGER_PORT ?? 3001}`,
  docdb: {
    hostname: process.env.DOCDB_HOST ?? "120.0.0.1",
    port: process.env.DOCDB_PORT ?? "27017",
    username: process.env.DOCDB_USERNAME,
    password: process.env.DOCDB_PASSWORD,
    use_tls: fs.existsSync(path.join(__dirname, "../../../global-bundle.pem")),
  },
  default_minutes_before_timeout: process.env.DEFAULT_MINUTES_BEFORE_TIMEOUT
    ? parseInt(process.env.DEFAULT_MINUTES_BEFORE_TIMEOUT)
    : 20,
};

export const defaultConfig: { [key: string]: DeploymentsConfig } = {
  mainnet: {
    network: "mainnet",
    nos_address:
      process.env.NOS_ADDRESS ?? "nosXBVoaCTtYdLvKY6Csb4AC8JCdQKKAaWYtx2ZMoo7",
    rpc_network:
      process.env.SOLANA_NETWORK ??
      "https://rpc.ironforge.network/mainnet?apiKey=01J4RYMAWZC65B6CND9DTZZ5BK",
    frps_address: process.env.FRPS_ADDRESS ?? "node.k8s.prd.nos.ci",
    dashboard_backend_url:
      process.env.DASHBOARD_BACKEND_URL || "https://dashboard.k8s.prd.nos.ci",
    client_manager_url: process.env.CLIENT_MANAGER_URL || undefined,
    ...commonConfig,
  },
  devnet: {
    network: "devnet",
    nos_address:
      process.env.NOS_ADDRESS ?? "devr1BGQndEW5k5zfvG5FsLyZv1Ap73vNgAHcQ9sUVP",
    rpc_network: process.env.SOLANA_NETWORK ?? "https://api.devnet.solana.com",
    frps_address: process.env.FRPS_ADDRESS ?? "node.k8s.dev.nos.ci",
    dashboard_backend_url:
      process.env.DASHBOARD_BACKEND_URL || "https://dashboard.k8s.dev.nos.ci",
    client_manager_url: process.env.CLIENT_MANAGER_URL || undefined,
    ...commonConfig,
  },
};
