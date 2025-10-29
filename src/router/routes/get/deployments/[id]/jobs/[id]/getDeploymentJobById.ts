import type { RouteHandler } from "fastify";

import { getSdk } from "../../../../../../../sdk/index.js";

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

  let results = await resultsCollection.findOne({
    job: job.job,
  });

  const onChain = await sdk.jobs.get(jobId);

  if (results === null && onChain.state === "COMPLETED") {
    results = await sdk.ipfs.retrieve(onChain.ipfsResult);
  }

  res.status(200).send({
    price: onChain.price,
    market: onChain.market.toString(),
    state: onChain.state,
    node: onChain.node,
    confidential: deployment.confidential,
    revision: job.revision,
    jobDefinition: revision.job_definition,
    results,
    created_at: job.created_at.toISOString(),
  });
} 