import { JobState } from "@nosana/kit";
import { address } from "@solana/addresses";
import { parentPort, workerData } from "worker_threads";

import { prepareWorker, workerErrorFormatter } from "../../../worker/Worker.js";

import type { WorkerData } from "../../../types/index.js";

const { kit, useNosanaApiKey, task } = await prepareWorker<WorkerData>(workerData);

try {
  const tasks = task.jobs.filter(({ revision }) => {
    return !(task.active_revision && task.active_revision === revision);
  });

  await Promise.all(tasks.map(async ({ job }) => {
    try {
      if (useNosanaApiKey) {
        const res = await kit.api!.jobs.stop(job);
        if (res) {
          parentPort!.postMessage({
            event: "CONFIRMED",
            job: res.job,
            tx: res.tx
          });
        }
      } else {
        const { state } = await kit.jobs.get(address(job));

        if (state === JobState.QUEUED) {
          const res = await kit.jobs.delist({ job: address(job) });
          if (res) {
            parentPort!.postMessage({
              event: "CONFIRMED",
              ...res,
            });
          }
        }

        if (state === JobState.RUNNING) {
          const res = await kit.jobs.end({ job: address(job) });
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
        error: workerErrorFormatter(error)
      });
    }
  }));
} catch (error) {
  parentPort!.postMessage({
    event: "ERROR",
    error: workerErrorFormatter(error)
  });
}
