import { DeploymentsConfig } from "../types.js";

export const defaultConfig: { [key: string]: DeploymentsConfig } = {
  mainnet: {
    network: "mainnet",
    nos_address:
      process.env.NOS_ADDRESS ?? "nosXBVoaCTtYdLvKY6Csb4AC8JCdQKKAaWYtx2ZMoo7",
    rpc_network:
      process.env.SOLANA_NETWORK ??
      "https://rpc.ironforge.network/mainnet?apiKey=01J4RYMAWZC65B6CND9DTZZ5BK",
    backend_url: process.env.BACKEND_URL ?? "mongodb://120.0.0.1:27017",
    tasks_batch_size: process.env.TASKS_BATCH_SIZE
      ? parseInt(process.env.TASKS_BATCH_SIZE)
      : 10,
    deployment_manager_port: 3000,
  },
  devnet: {
    network: "devnet",
    nos_address:
      process.env.NOS_ADDRESS ?? "devr1BGQndEW5k5zfvG5FsLyZv1Ap73vNgAHcQ9sUVP",
    rpc_network: process.env.SOLANA_NETWORK ?? "devnet",
    backend_url: process.env.BACKEND_URL ?? "mongodb://120.0.0.1:27017",
    tasks_batch_size: process.env.TASKS_BATCH_SIZE
      ? parseInt(process.env.TASKS_BATCH_SIZE)
      : 10,
    deployment_manager_port: 3000,
  },
};
