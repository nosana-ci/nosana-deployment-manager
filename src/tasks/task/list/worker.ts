import { parentPort, workerData } from "worker_threads";

import { Client } from "@nosana/sdk";

import { decryptWithKey } from "../../../vault/decrypt.js";
import { covertStringToIterable } from "../../utils/convertStringToIterable.js";

import type {
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
  config: { confidential_ipfs_pin, network, rpc_network },
} = workerData as WorkerData;

const key = decryptWithKey(vault);
const useNosanaApiKey = key.startsWith("Bearer ");

const client = useNosanaApiKey ? new Client(network, undefined, {
  apiKey: key.replace("Bearer ", ""),
}) : new Client(network, covertStringToIterable(vault), {
  solana: { network: rpc_network },
});

const { active_revision, confidential, market, replicas, timeout } = task.deployment;

let ipfs_definition_hash: string = confidential_ipfs_pin;

if (!confidential) {
  const activeRevision = task.revisions.find(({ revision }) => revision === active_revision);

  if (!activeRevision) {
    parentPort!.postMessage({
      event: "ERROR",
      error: "Active revision not found",
    });
    process.exit(1);
  }

  ipfs_definition_hash = activeRevision.ipfs_definition_hash;
}

// TODO, convert to Single instruction
for (let i = 0; i < replicas; i++) {
  try {
    const res = await (useNosanaApiKey ? client.api.jobs.list(ipfs_definition_hash, timeout, market) : client.jobs
      .list(ipfs_definition_hash, timeout, market, undefined))
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
