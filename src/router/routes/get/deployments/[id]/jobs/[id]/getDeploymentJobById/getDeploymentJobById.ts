import type { RouteHandler } from "fastify";

import { getKit } from "../../../../../../../../kit/index.js";
import { findJobAccount } from "../../../../../../../../listeners/accounts/helpers/index.js";
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
  const { results: resultsCollection, jobs: jobsCollection, revisions: revisionsCollection } = res.locals.db

  const job = await jobsCollection.findOne({ job: jobId, deployment: deployment.id });

  if (!job) {
    res.status(404).send({
      error: "Job not found",
    });
    return;
  }

  const revision = await revisionsCollection.findOne({ deployment: deployment.id, revision: job.revision });

  if (!revision) {
    res.status(500).send({
      error: "Job revision not found",
    });
    return;
  }

  const results = await resultsCollection.findOne({
    job: job.job,
  });

  try {
    // The chain is the authority on the job's lifecycle. A queued job that was
    // delisted has no account any more; our record is then all there is.
    const onchain = await findJobAccount(kit, job.job);

    res.status(200).send(await buildDeploymentJobResponse(deployment, job, revision, results, onchain));
  } catch (error) {
    req.log.error(error);
    res.status(500).send({
      error: "Failed to get deployment job",
    });
  }
} 
