import { RouteHandler } from "fastify";

import { ErrorMessages } from "../../../../../errors/index.js";

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
    // reply cap.
    const revision = await db.revisions.findOne({ deployment: job.deployment, revision: job.revision });

    if (!revision) {
      res.status(404).send({ error: ErrorMessages.job.FAILED_TO_FIND_JOB_DEFINITION });
      return;
    }

    res.status(200).send(revision.job_definition);
  } catch (error) {
    res.log.error(error);
    res
      .status(500)
      .send({ error: ErrorMessages.generic.SOMETHING_WENT_WRONG });
  }
}
