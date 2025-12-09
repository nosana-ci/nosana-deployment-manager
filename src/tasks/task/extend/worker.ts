import { address } from "@solana/addresses";
import { parentPort, workerData } from "worker_threads";

import { prepareWorker, workerErrorFormatter } from "../../../worker/Worker.js";

import type { WorkerData } from "../../../types/index.js";

const {
  kit,
  useNosanaApiKey,
  task: { deployment: { timeout }, job }
} = await prepareWorker<WorkerData>(workerData);

try {
  if (!job) {
    throw new Error("No job specified for extension.");
  }

  try {
    if (useNosanaApiKey) {
      const res = await kit.api!.jobs.extend({ address: job, seconds: timeout });
      if (res) {
        parentPort?.postMessage({
          event: "CONFIRMED",
          tx: res.tx,
          job: res.job,
        });
      }
    } else {
      const res = await kit.jobs.extend({ job: address(job), timeout });
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
      error: workerErrorFormatter(error)
    });
  }
} catch (error) {
  parentPort?.postMessage({
    event: "ERROR",
    error: workerErrorFormatter(error)
  });
}
