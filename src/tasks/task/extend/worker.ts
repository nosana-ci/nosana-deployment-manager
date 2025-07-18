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
