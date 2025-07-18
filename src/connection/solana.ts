import { getDeepStore } from "deep-context-stores";
import { Cluster, clusterApiUrl, Connection } from "@solana/web3.js";

import { DeploymentsConfig } from "../types";

export const ConnectionSelector = (): Connection => {
  let instance: Connection | undefined = undefined;

  if (!instance) {
    const { rpc_network } = getDeepStore<DeploymentsConfig>();
    let node = rpc_network;
    if (!node.includes("http")) {
      node = clusterApiUrl(node as Cluster);
    }

    instance = new Connection(node, {
      commitment: "confirmed",
      confirmTransactionInitialTimeout: 60 * 1000,
    });
  }

  return instance;
};
