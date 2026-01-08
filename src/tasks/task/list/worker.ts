import { Client } from "@nosana/sdk";
import { parentPort, workerData } from "worker_threads";

import { prepareWorker, workerErrorFormatter } from "../Worker.js";

type ApiListResponse = Awaited<ReturnType<Client["api"]["jobs"]["list"]>>

try {
  const { client, useNosanaApiKey, task } = await prepareWorker(workerData);

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

  const transformApiResponse = (res: ApiListResponse) => ({
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
            const res = await client.api.jobs.list(listArgs);
            parentPort!.postMessage({
              event: "CONFIRMED",
              ...transformApiResponse(res),
            });
          } else {
            const res = await client.jobs.list(ipfs_definition_hash, timeout * 60, market);
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

