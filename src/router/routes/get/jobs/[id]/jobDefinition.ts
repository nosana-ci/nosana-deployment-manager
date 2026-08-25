import { RouteHandler } from "fastify";

import { ErrorMessages } from "../../../../../errors/index.js";
import { injectSsh } from "../../../../../ssh/index.js";

import type { JobDefinitionHandlerError, JobDefinitionHandlerSuccess } from "../../../../schema/get/index.schema.js";

export const jobDefinitionHandler: RouteHandler<{
  Params: { job: string };
  Reply: JobDefinitionHandlerSuccess | JobDefinitionHandlerError;
}> = async (req, res) => {
  const { db } = res.locals;
  const jobId = req.params.job;

  try {
    const job = await db.jobs.findOne({ job: jobId });

    if (!job) {
      res.status(404).send({ error: ErrorMessages.job.NOT_FOUND });
      return;
    }

    // Fetch only the job's own revision: a $lookup of every revision of the
    // deployment (each carrying a full job_definition) can exceed the 16MB
    // reply cap. The deployment read (for the CURRENT SSH keys — confidential
    // jobs take their definition from here rather than IPFS, so this is where
    // the keys are injected) is independent, so run both in parallel.
    const [revision, deployment] = await Promise.all([
      db.revisions.findOne({ deployment: job.deployment, revision: job.revision }),
      db.deployments.findOne({ id: job.deployment }, { projection: { ssh_public_keys: 1 } }),
    ]);

    if (!revision) {
      res.status(404).send({ error: ErrorMessages.job.FAILED_TO_FIND_JOB_DEFINITION });
      return;
    }

    res.status(200).send(injectSsh(revision.job_definition, deployment?.ssh_public_keys));
  } catch (error) {
    res.log.error(error);
    res
      .status(500)
      .send({ error: ErrorMessages.generic.SOMETHING_WENT_WRONG });
  }
}
