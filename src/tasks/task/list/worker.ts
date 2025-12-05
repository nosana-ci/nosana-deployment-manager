import { address } from "@solana/addresses";
import { NosanaApiListJobResponse } from "@nosana/kit";
import { parentPort, workerData } from "worker_threads";

import { prepareWorker, workerErrorFormatter } from "../../../worker/Worker.js";
import type { WorkerData } from "../../../types/index.js";

try {
  const { kit, useNosanaApiKey, task } = await prepareWorker<WorkerData>(workerData);

  const { active_revision, confidential, market, replicas, timeout, strategy } = task.deployment;

  let ipfs_definition_hash: string = workerData.confidential_ipfs_pin;

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

  const transformApiResponse = (res: NosanaApiListJobResponse) => ({
    tx: res.tx,
    job: res.job,
    run: res.run
  });

  await Promise.all(
    Array.from(
      { length: strategy === "SIMPLE" || strategy === "SIMPLE-EXTEND" ? replicas - task.jobs.length : replicas },
      async () => {
        try {
          if (useNosanaApiKey) {
            const listArgs = { ipfsHash: ipfs_definition_hash, timeout: timeout * 60, market };
            const res = await kit.api!.jobs.list(listArgs);
            parentPort!.postMessage({
              event: "CONFIRMED",
              ...transformApiResponse(res),
            });
          } else {
            const res = await kit.jobs.post({
              ipfsHash: ipfs_definition_hash, timeout: timeout * 60, market: address(market)
            });
            parentPort!.postMessage({
              event: "CONFIRMED",
              ...res,
            });
          }
        } catch (error) {
          parentPort!.postMessage({
            event: "ERROR",
            error: workerErrorFormatter(error),
          });
        }
      }
    )
  );
} catch (error) {
  parentPort!.postMessage({
    event: "ERROR",
    error: workerErrorFormatter(error),
  });
}

