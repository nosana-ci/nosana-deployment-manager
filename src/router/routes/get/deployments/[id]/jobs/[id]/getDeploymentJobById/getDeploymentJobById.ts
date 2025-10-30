import type { RouteHandler } from "fastify";

import { getSdk } from "../../../../../../../../sdk/index.js";
import { buildDeploymentJobResponse } from "./buildDeploymentJobResponse.js";

export const getDeploymentJobByIdHandler: RouteHandler<{
  Params: { deployment: string; job: string };
}> = async (req, res) => {
  const sdk = getSdk()
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

  const jobData = await sdk.api.jobs.get(jobId);

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