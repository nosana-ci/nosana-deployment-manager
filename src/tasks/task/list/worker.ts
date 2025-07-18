import fs from "fs";
import { register } from "ts-node";
import { parentPort, workerData } from "worker_threads";

import { Client } from "@nosana/sdk";

import { DeploymentsConfig, OutstandingTasksDocument } from "../../../types.js";

register();

type WorkerData = {
  task: OutstandingTasksDocument;
  vault: string;
  network: DeploymentsConfig["network"];
};

const { task, vault, network } = workerData as WorkerData;

const client = new Client(network, fs.readFileSync(vault, "utf8"));

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
