import { parentPort, workerData } from "worker_threads";

import { Client } from "@nosana/sdk";

import { covertStringToIterable } from "../../utils/convertStringToIterable.js";

import { DeploymentsConfig, OutstandingTasksDocument } from "../../../types.js";

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

for (const { job } of task.jobs) {
  try {
    const { state } = await client.jobs.get(job);

    if (state === "QUEUED") {
      const res = await client.jobs.delist(job);
      if (res) {
        parentPort!.postMessage({
          event: "CONFIRMED",
          ...res,
        });
      }
    }

    if (state === "RUNNING") {
      const res = await client.jobs.end(job);
      if (res) {
        parentPort!.postMessage({
          event: "CONFIRMED",
          ...res,
        });
      }
    }
  } catch (error) {
    parentPort!.postMessage({
      event: "ERROR",
      error,
    });
  }
}
