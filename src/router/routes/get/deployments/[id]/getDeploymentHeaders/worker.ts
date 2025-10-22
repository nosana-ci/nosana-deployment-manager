import { Client } from "@nosana/sdk";
import { parentPort, workerData } from "worker_threads";

import { decryptWithKey } from "../../../../../../vault/decrypt.js";
import { covertStringToIterable } from "../../../../../../tasks/utils/convertStringToIterable.js";

try {
  const { register } = await import("ts-node");
  register();
} catch {
  /* empty */
}

type WorkerData = {
  includeTime: boolean;
  config: { network: "mainnet" | "devnet"; rpc_network: string };
  vault: string;
};

const { includeTime, config: { network, rpc_network }, vault } = workerData as WorkerData;

const key = decryptWithKey(vault);

const client = new Client(network, covertStringToIterable(key), {
  solana: { network: rpc_network },
});

try {
  const header = await client.authorization.generate("DEPLOYMENT_HEADER", {
    includeTime,
  });

  parentPort!.postMessage({
    event: "GENERATED",
    header,
  });
} catch (error) {
  parentPort!.postMessage({
    event: "ERROR",
    error,
  });
}
