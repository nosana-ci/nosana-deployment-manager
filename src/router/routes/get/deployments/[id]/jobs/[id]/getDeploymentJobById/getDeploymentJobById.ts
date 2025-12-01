import type { RouteHandler } from "fastify";

import { getKit } from "../../../../../../../../kit/index.js";
import { buildDeploymentJobResponse } from "./buildDeploymentJobResponse.js";

import type { HeadersSchema } from "../../../../../../../schema/index.schema.js";
import type { DeploymentJobByIdError, DeploymentJobByIdSuccess } from "../../../../../../../schema/get/index.schema.js";

export const deploymentJobByIdHandler: RouteHandler<{
  Params: { deployment: string; job: string };
  Headers: HeadersSchema;
  Reply: DeploymentJobByIdSuccess | DeploymentJobByIdError;
}> = async (req, res) => {
  const kit = getKit();
  const { job: jobId } = req.params;
  const deployment = res.locals.deployment!
  const { results: resultsCollection } = res.locals.db

  const job = deployment.jobs.find((job) => job.job === jobId);

  if (!job) {
    res.status(404).send({
      error: "Job not found",
    });
    return;
  }

  const revision = deployment.revisions.find((rev) => rev.revision === job.revision);

  if (!revision) {
    res.status(500).send({
      error: "Job revision not found",
    });
    return;
  }

  const jobData = await kit.api!.jobs.get(jobId);

  if (!jobData) {
    res.status(500).send({
      error: "Job not found in indexer",
    });
    return;
  }

  const results = await resultsCollection.findOne({
    job: job.job,
  });

  res.status(200).send(await buildDeploymentJobResponse(
    deployment,
    job,
    revision,
    results,
    jobData
  ));
} 