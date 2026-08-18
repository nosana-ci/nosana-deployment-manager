import { parentPort, workerData } from "worker_threads";

import { prepareWorker } from "../../../../../../worker/Worker.js";

type WorkerData = {
  includeTime: boolean;
  message?: string;
  vault: string;
};

const DEFAULT_MESSAGE = "DEPLOYMENT_HEADER";

try {
  const { kit, useNosanaApiKey, includeTime, message = DEFAULT_MESSAGE } =
    await prepareWorker<WorkerData>(workerData);

  if (useNosanaApiKey) {
    const header = await kit.api!.auth.signMessage(message, { includeTime });
    parentPort!.postMessage({
      event: "GENERATED",
      header: header,
    });
  } else {
    const header = await kit.authorization.generate(message, { includeTime });
    parentPort!.postMessage({
      event: "GENERATED",
      header,
    });
  }
} catch (error) {
  parentPort!.postMessage({
    event: "ERROR",
    error,
  });
}
