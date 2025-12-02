import { JobState } from "@nosana/kit";
import { address } from "@solana/addresses";
import { parentPort, workerData } from "worker_threads";
import { prepareWorker, workerErrorFormatter } from "../../../worker/Worker.js";
import type { WorkerData } from "../../../types/index.js";

const { kit, useNosanaApiKey, task } = await prepareWorker<WorkerData>(workerData);

try {
  const jobs = task.jobs
    .filter(({ revision }) => !(task.active_revision && task.active_revision === revision))
    .sort(({ updated_at: a }, { updated_at: b }) => a.getTime() - b.getTime())
    .slice(0, task.limit || task.jobs.length);

  await Promise.all(jobs.map(async ({ job }) => {
    const { state } = await kit.jobs.get(address(job));
    if ([JobState.COMPLETED, JobState.STOPPED].includes(state)) return;

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
