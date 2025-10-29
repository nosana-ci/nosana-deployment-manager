import { parentPort, workerData } from "worker_threads";

import { prepareWorker } from "../Worker.js";

const {
  client,
  useNosanaApiKey,
  task: { deployment: { timeout }, jobs }
} = await prepareWorker(workerData);

try {
  await Promise.all(jobs.map(async ({ job }) => {
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
  }));
} catch (error) {
  parentPort?.postMessage({
    event: "ERROR",
    error
  });
}
