import path from "path";
import { fileURLToPath } from "url";
import { Worker } from "worker_threads";
import type { RouteHandler } from "fastify";

import { getConfig } from "../../../../../../config/index.js";
import type { HeadersSchema } from "../../../../../schema/index.schema.js";
import { GetDeploymentHeaderSuccess, GetDeploymentHeaderError } from "../../../../../schema/get/deployments/[id]/getDeploymentHeader.schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

    const worker = new Worker(path.resolve(__dirname, "./worker.js"), {
      workerData: {
        includeTime: includeTime === "true",
        config: getConfig(),
        vault: vaultDocument.vault_key,
      },
    });

    worker.on("message", ({ event, header, error, }) => {
      switch (event) {
        case "GENERATED":
          console.log("Generated header:", header);
          res.status(200);
          return { header };
        case "ERROR":
          res.log.error("Error occurred in worker:", error);
          res.status(500).send({ error: "Failed to generate header." });
      }
    });

    return
  } catch (error) {
    req.log.error(error, "Failed to get scheduled tasks for deployment");
    res.status(500).send({
      error: "Failed to get scheduled tasks",
    });
  }
};
