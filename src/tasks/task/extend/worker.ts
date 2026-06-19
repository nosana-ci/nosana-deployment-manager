import { address } from "@solana/addresses";
import { parentPort, workerData } from "worker_threads";

import {
  prepareWorker,
  workerErrorFormatter,
  signTransactionToBlob,
} from "../../../worker/Worker.js";
import type { WorkerData } from "../../../types/index.js";

/**
 * EXTEND signer worker (single unit).
 *
 * Self-custody: build + sign the extend tx and emit SIGNED (parent sends).
 * API-key (unchanged): submit via the API and emit CONFIRMED.
 */
try {
  const { kit, useNosanaApiKey, task, startUnit = 0 } =
    await prepareWorker<WorkerData>(workerData);
  const {
    deployment: { timeout },
    job,
  } = task;

  if (!job) {
    throw new Error("No job specified for extension.");
  }

  try {
    if (useNosanaApiKey) {
      const res = await kit.api!.jobs.extend({ address: job, seconds: timeout * 60 });
      if (res) {
        parentPort!.postMessage({ event: "CONFIRMED", unit: startUnit, job: res.job, tx: res.tx });
      }
    } else {
      const instruction = await kit.jobs.extend({ job: address(job), timeout: timeout * 60 });
      const { blob, lastValidBlockHeight } = await signTransactionToBlob(kit, instruction);

      parentPort!.postMessage({
        event: "SIGNED",
        unit: startUnit,
        blob,
        lastValidBlockHeight,
        jobs: [job],
      });
    }
  } catch (error) {
    parentPort!.postMessage({ event: "ERROR", unit: startUnit, error: workerErrorFormatter(error) });
  }

  parentPort!.postMessage({ event: "DONE" });
} catch (error) {
  parentPort!.postMessage({ event: "ERROR", error: workerErrorFormatter(error) });
}
