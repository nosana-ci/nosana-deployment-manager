import { Worker } from "worker_threads";
import type { RouteHandler } from "fastify";

import { getConfig } from "../../../../../../config/index.js";
import type { HeadersSchema } from "../../../../../schema/index.schema.js";
import { GetDeploymentHeaderSuccess, GetDeploymentHeaderError } from "../../../../../schema/get/deployments/[id]/getDeploymentHeader.schema.js";

export const deploymentGetHeaderHandler: RouteHandler<{
  Params: { deployment: string };
  Querystring: { includeTime?: string };
  Headers: HeadersSchema;
  Reply: GetDeploymentHeaderSuccess | GetDeploymentHeaderError;
}> = async (req, res) => {
  const owner = req.headers["x-user-id"];
  const { includeTime } = req.query;
  const {
    db: { vaults },
  } = res.locals;

  const { vault } = res.locals.deployment!;

  try {
    const vaultDocument = await vaults.findOne({
      vault,
      owner,
    });

    if (!vaultDocument) {
      res.status(500).send({
        error: "Failed to get deployment vault",
      });
      return;
    }

    const worker = new Worker("./worker.ts", {
      workerData: {
        includeTime: includeTime === "true",
        network: getConfig().network,
        vault: vaultDocument.vault,
      },
    });

    worker.on("message", (message) => {
      switch (message) {
        case "GENERATED":
          res.status(200).send(message.header);
          break;
        case "ERROR":
          res.log.error("Error occurred in worker:", message);
          res.status(500).send({ error: "Failed to generate header." });
          break;
      }
    });
  } catch (error) {
    req.log.error(error, "Failed to get scheduled tasks for deployment");
    res.status(500).send({
      error: "Failed to get scheduled tasks",
    });
  }
};
