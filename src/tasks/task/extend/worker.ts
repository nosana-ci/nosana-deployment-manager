import { parentPort, workerData } from "worker_threads";

import { Client } from "@nosana/sdk";

import { decryptWithKey } from "../../../vault/decrypt.js";
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
  config: { network, rpc_network, dashboard_backend_url },
} = workerData as WorkerData;

const key = decryptWithKey(vault);
const useNosanaApiKey = key.startsWith("nos_");

const client = useNosanaApiKey ? new Client(network, undefined, {
  apiKey: key,
  ...(dashboard_backend_url && { api: { backend_url: dashboard_backend_url } }),
}) : new Client(network, covertStringToIterable(key), {
  solana: { network: rpc_network },
});

const {
  deployment: { timeout },
  jobs,
} = task;

for (const { job } of jobs) {
  try {
    if (useNosanaApiKey) {
      const res = await client.api.jobs.extend({ jobAddress: job, extensionSeconds: timeout });
      if (res) {
        parentPort?.postMessage({
          event: "CONFIRMED",
          tx: res.transactionId,
          job: res.jobAddress,
        });
      }
    } else {
      const res = await client.jobs.extend(job, timeout);
      if (res) {
        parentPort?.postMessage({
          event: "CONFIRMED",
          ...res
        });
      }
    }
  } catch (error) {
    parentPort?.postMessage({
      event: "ERROR",
      error
    });
  }
}
