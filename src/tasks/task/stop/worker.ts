import { parentPort, workerData } from "worker_threads";

import { Client } from "@nosana/sdk";

import { covertStringToIterable } from "../../utils/convertStringToIterable.js";

import {
  DeploymentsConfig,
  OutstandingTasksDocument,
} from "../../../types/index.js";
import { decryptWithKey } from "../../../vault/decrypt.js";

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

const key = decryptWithKey(vault);
const useNosanaApiKey = key.startsWith("Bearer ");

const client = useNosanaApiKey ? new Client(network, undefined, {
  apiKey: key.replace("Bearer ", ""),
}) : new Client(network, covertStringToIterable(vault), {
  solana: { network: rpc_network },
});

for (const { job } of task.jobs) {
  try {
    const { state } = await client.jobs.get(job);

    if (state === "QUEUED") {
      const res = useNosanaApiKey ? await client.api.jobs.stop(job) : await client.jobs.delist(job);

      if (res) {
        parentPort!.postMessage({
          event: "CONFIRMED",
          ...res,
        });
      }
    }

    if (state === "RUNNING") {
      const res = useNosanaApiKey ? await client.api.jobs.stop(job) : await client.jobs.end(job);
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
