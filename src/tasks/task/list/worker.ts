import { parentPort, workerData } from "worker_threads";

import { Client } from "@nosana/sdk";

import { covertStringToIterable } from "../../utils/convertStringToIterable.js";

import {
  DeploymentsConfig,
  OutstandingTasksDocument,
} from "../../../types/index.js";

try {
  const { register } = await import("ts-node");
  register();
} catch {
  /* empty */
}

type WorkerData = {
  task: OutstandingTasksDocument;
  vault: string;
  config: DeploymentsConfig;
};

const {
  task,
  vault,
  config: { network, rpc_network },
} = workerData as WorkerData;

const client = new Client(network, covertStringToIterable(vault), {
  solana: { network: rpc_network },
});

const { ipfs_definition_hash, timeout, market, replicas } = task.deployment;

// TODO, convert to Single instruction
for (let i = 0; i < replicas; i++) {
  try {
    const res = await client.jobs
      .list(ipfs_definition_hash, timeout, market, undefined)
      .catch((err) => {
        parentPort!.postMessage({
          event: "ERROR",
          error: err instanceof Error ? err.message : String(err),
        });
      });

    if (res) {
      parentPort!.postMessage({
        event: "CONFIRMED",
        ...res,
      });
    }
  } catch (err) {
    parentPort!.postMessage({
      event: "ERROR",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
