import { parentPort, workerData } from "worker_threads";

import { Client } from "@nosana/sdk";

try {
  const { register } = await import("ts-node");
  register();
} catch {
  /* empty */
}

type WorkerData = {
  includeTime: boolean;
  network: "mainnet" | "devnet";
  vault: string;
};

const { includeTime, network, vault } = workerData as WorkerData;

const client = new Client(network, vault);

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
