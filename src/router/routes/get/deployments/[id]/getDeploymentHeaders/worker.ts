import { parentPort, workerData } from "worker_threads";

import { prepareWorker, signAuthHeader } from "../../../../../../worker/Worker.js";

type WorkerData = {
  includeTime: boolean;
  message?: string;
  vault: string;
};

const DEFAULT_MESSAGE = "DEPLOYMENT_HEADER";

try {
  const { kit, useNosanaApiKey, includeTime, message = DEFAULT_MESSAGE } =
    await prepareWorker<WorkerData>(workerData);

  const header = await signAuthHeader(kit, useNosanaApiKey, message, { includeTime });
  parentPort!.postMessage({
    event: "GENERATED",
    header,
  });
} catch (error) {
  parentPort!.postMessage({
    event: "ERROR",
    error,
  });
}
