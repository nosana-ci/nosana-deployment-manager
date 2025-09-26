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

    try {
      const header: string = await new Promise((resolve, reject) => {
        const worker = new Worker(path.resolve(__dirname, "./worker.js"), {
          workerData: {
            includeTime: includeTime === "true",
            config: getConfig(),
            vault: vaultDocument.vault_key,
          },
        });



        worker.on("message", ({ event, header: generatedHeader, error, }) => {
          switch (event) {
            case "GENERATED":
              resolve(generatedHeader);
              break;
            case "ERROR":
              reject(error)
              break;
            default:
              reject("Unknown event from worker");
          }
        });
      });

      res.status(200)
      return { header };
    } catch (error) {
      res.log.error("Error occurred while generating header:", error);
      res.status(500).send({ error: "Failed to generate header." });
    }
  } catch (error) {
    req.log.error(error, "Failed to get scheduled tasks for deployment");
    res.status(500).send({
      error: "Failed to get scheduled tasks",
    });
  }
};
