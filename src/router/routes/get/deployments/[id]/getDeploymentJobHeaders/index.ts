import type { RouteHandler } from "fastify";

import { ErrorMessages } from "../../../../../../errors/index.js";
import { JobState } from "../../../../../../types/index.js";
import { VaultWorker } from "../../../../../../worker/Worker.js";

import type { HeadersSchema } from "../../../../../schema/index.schema.js";
import type {
  GetDeploymentJobHeadersSuccess,
  GetDeploymentJobHeadersError,
} from "../../../../../schema/get/deployments/[id]/getDeploymentJobHeaders.schema.js";
import type { JobHeadersWorkerData, JobHeadersWorkerMessage } from "./worker.js";

function signJobHeaders(data: JobHeadersWorkerData): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const worker = new VaultWorker<JobHeadersWorkerData>(
      "../router/routes/get/deployments/[id]/getDeploymentJobHeaders/worker.js",
      { workerData: data }
    );

    worker.on("message", (message: JobHeadersWorkerMessage) => {
      if (message.event === "GENERATED") resolve(message.headers);
      else if (message.event === "ERROR") reject(new Error(message.error));
      else reject(new Error("Unknown event from worker"));
    });
    worker.on("error", reject);
  });
}

/**
 * Sign a header for every running job of the deployment in one request, keyed
 * by job address. Each header has the job address as its message and a
 * timestamp, so it authorizes that job's node calls only, until it expires.
 */
export const deploymentGetJobHeadersHandler: RouteHandler<{
  Params: { deployment: string };
  Headers: HeadersSchema;
  Reply: GetDeploymentJobHeadersSuccess | GetDeploymentJobHeadersError;
}> = async (req, res) => {
  const owner = req.headers["x-user-id"];
  const { db } = res.locals;
  const { id, vault } = res.locals.deployment!;

  try {
    const vaultDocument = await db.vaults.findOne({ vault, owner });
    if (!vaultDocument) {
      res.status(500).send({ error: ErrorMessages.vaults.FAILED_TO_FIND_KEY });
      return;
    }

    const running = await db.jobs
      .find(
        { deployment: id, state: JobState.RUNNING, node: { $ne: null } },
        { projection: { job: 1 } }
      )
      .toArray();

    const headers =
      running.length === 0
        ? {}
        : await signJobHeaders({
            vault: vaultDocument.vault_key,
            jobs: running.map(({ job }) => job),
          });

    res.status(200).send({ headers });
  } catch (error) {
    res.log.error("Error occurred while generating job headers: %s", String(error));
    res.status(500).send({ error: "Failed to generate job headers." });
  }
};
