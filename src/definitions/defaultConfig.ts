import { DeploymentsConfig } from "../types.js";

export const defaultConfig: { [key: string]: DeploymentsConfig } = {
  mainnet: {
    network: "mainnet",
    nos_address: "nosXBVoaCTtYdLvKY6Csb4AC8JCdQKKAaWYtx2ZMoo7",
    rpc_network:
      "https://rpc.ironforge.network/mainnet?apiKey=01J4RYMAWZC65B6CND9DTZZ5BK",
    backend_url: "http://localhost:3000",
    tasks_batch_size: 10,
  },
  devnet: {
    network: "devnet",
    nos_address: "devr1BGQndEW5k5zfvG5FsLyZv1Ap73vNgAHcQ9sUVP",
    rpc_network: "devnet",
    backend_url: "http://localhost:3000",
    tasks_batch_size: 10,
  },
};
