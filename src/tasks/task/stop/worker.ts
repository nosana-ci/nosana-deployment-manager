import { parentPort, workerData } from "worker_threads";

import { prepareWorker } from "../Worker.js";

const { client, useNosanaApiKey, task } = await prepareWorker(workerData);

try {
  const tasks = task.jobs.filter(({ revision }) => {
    return !(task.active_revision && task.active_revision === revision);
  });

  await Promise.all(tasks.map(async ({ job }) => {
    try {
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
      }
    } catch (error) {
      parentPort!.postMessage({
        event: "ERROR",
        error
      });
    }
  }));
} catch (error) {
  parentPort!.postMessage({
    event: "ERROR",
    error
  });
}
