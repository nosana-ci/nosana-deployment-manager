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
const useNosanaApiKey = key.startsWith("nos_");

const client = useNosanaApiKey ? new Client(network, undefined, {
  apiKey: key,
}) : new Client(network, covertStringToIterable(key), {
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
    if (useNosanaApiKey) {
      const res = await client.api.jobs.list({ ipfsHash: ipfs_definition_hash, timeout: timeout * 60, market }).catch((err) => {
        parentPort!.postMessage({
          event: "ERROR",
          error: typeof err === "object" ? JSON.stringify(err) : String(err),
        });
      });
      if (res) {
        parentPort!.postMessage({
          event: "CONFIRMED",
          tx: res.reservationId,
          job: res.jobAddress,
          run: ""
        });
      }
    } else {
      const res = client.jobs.list(ipfs_definition_hash, timeout, market, undefined)
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
    }
  } catch (err) {
    parentPort!.postMessage({
      event: "ERROR",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
