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
  config: { network, rpc_network, dashboard_backend_url },
} = workerData as WorkerData;

const key = decryptWithKey(vault);
const useNosanaApiKey = key.startsWith("nos_");

try {
  const client = useNosanaApiKey ? new Client(network, undefined, {
    apiKey: key,
    ...(dashboard_backend_url && { api: { backend_url: dashboard_backend_url } }),
  }) : new Client(network, covertStringToIterable(key), {
    solana: { network: rpc_network },
  });

  for (const { job, revision } of task.jobs) {
    if (task.active_revision && task.active_revision === revision) {
      continue;
    }
    try {
      const { state } = await client.jobs.get(job);

      if (state === "QUEUED") {
        if (useNosanaApiKey) {
          const res = await client.api.jobs.stop({ jobAddress: job });
          if (res) {
            parentPort!.postMessage({
              event: "CONFIRMED",
              job: res.jobAddress,
              tx: res.transactionId
            });
          }
        } else {
          const res = await client.jobs.delist(job);
          if (res) {
            parentPort!.postMessage({
              event: "CONFIRMED",
              ...res,
            });
          }
        }
      }

      if (state === "RUNNING") {
        if (useNosanaApiKey) {
          const res = await client.api.jobs.stop({ jobAddress: job })
          if (res) {
            parentPort!.postMessage({
              event: "CONFIRMED",
              job: res.jobAddress,
              tx: res.transactionId
            });
          }
        } else {
          const res = useNosanaApiKey ? await client.api.jobs.stop({ jobAddress: job }) : await client.jobs.end(job);
          if (res) {
            parentPort!.postMessage({
              event: "CONFIRMED",
              ...res,
            });
          }
        }
      }
    } catch (error) {
      parentPort!.postMessage({
        event: "ERROR",
        error
      });
    }
  }
} catch (error) {
  parentPort!.postMessage({
    event: "ERROR",
    error
  });
}
