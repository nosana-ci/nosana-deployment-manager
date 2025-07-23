import { DeploymentsConfig } from "../types.js";

const commonConfig: Pick<
  DeploymentsConfig,
  "tasks_batch_size" | "deployment_manager_port" | "docdb"
> = {
  tasks_batch_size: process.env.TASKS_BATCH_SIZE
    ? parseInt(process.env.TASKS_BATCH_SIZE)
    : 10,
  deployment_manager_port: process.env.DEPLOYMENT_MANAGER_PORT
    ? parseInt(process.env.DEPLOYMENT_MANAGER_PORT)
    : 3000,
  docdb: {
    hostname: process.env.DOCDB_HOST ?? "120.0.0.1",
    port: process.env.DOCDB_PORT ?? "27017",
    username: process.env.DOCDB_USERNAME,
    password: process.env.DOCDB_PASSWORD,
  },
};

export const defaultConfig: { [key: string]: DeploymentsConfig } = {
  mainnet: {
    network: "mainnet",
    nos_address:
      process.env.NOS_ADDRESS ?? "nosXBVoaCTtYdLvKY6Csb4AC8JCdQKKAaWYtx2ZMoo7",
    rpc_network:
      process.env.SOLANA_NETWORK ??
      "https://rpc.ironforge.network/mainnet?apiKey=01J4RYMAWZC65B6CND9DTZZ5BK",
    ...commonConfig,
  },
  devnet: {
    network: "devnet",
    nos_address:
      process.env.NOS_ADDRESS ?? "devr1BGQndEW5k5zfvG5FsLyZv1Ap73vNgAHcQ9sUVP",
    rpc_network: process.env.SOLANA_NETWORK ?? "devnet",
    ...commonConfig,
  },
};
