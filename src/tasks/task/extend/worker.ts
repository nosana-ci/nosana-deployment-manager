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
  network: DeploymentsConfig["network"];
};

const { task, vault, network } = workerData as WorkerData;
const client = new Client(network, covertStringToIterable(vault));

const {
  deployment: { timeout },
  jobs,
} = task;

for (const { job } of jobs) {
  try {
    const res = await client.jobs.extend(job, timeout);
    if (res) {
      parentPort?.postMessage({
        event: "CONFIRMED",
        ...res,
      });
    }
  } catch (error) {
    parentPort?.postMessage({
      event: "ERROR",
      error,
    });
  }
}
