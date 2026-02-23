import { parentPort, workerData } from "worker_threads";

import { prepareWorker } from "../../../../../../worker/Worker.js";

type WorkerData = {
  includeTime: boolean;
  vault: string;
};

const MESSAGE = "DEPLOYMENT_HEADER";

try {
  const { kit, useNosanaApiKey, includeTime } = await prepareWorker<WorkerData>(workerData);

  if (useNosanaApiKey) {
    const res = await kit.api!.auth.signMessage(MESSAGE, { includeTime });
    if (res) {
      parentPort!.postMessage({
        event: "GENERATED",
        header: res.header,
      });
    }
  } else {
    const header = await kit.authorization.generate(MESSAGE, { includeTime });
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
