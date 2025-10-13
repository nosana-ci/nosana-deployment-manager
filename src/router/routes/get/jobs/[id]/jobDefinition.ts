import { RouteHandler } from "fastify";

import { ErrorMessages } from "../../../../../errors/index.js";

import type { JobsDocument, RevisionDocument } from "../../../../../types/index.js";
import type { JobDefinitionHandlerError, JobDefinitionHandlerSuccess } from "../../../../schema/get/index.schema.js";

type JobDeploymentRevision = JobsDocument & {
  revisions: RevisionDocument[]
};

export const jobDefinitionHandler: RouteHandler<{
  Params: { job: string };
  Reply: JobDefinitionHandlerSuccess | JobDefinitionHandlerError;
}> = async (req, res) => {
  const { db } = res.locals;
  const jobId = req.params.job;

  try {
    const job = await db.jobs.aggregate().match({ job: { $eq: jobId } }).lookup({ from: "revisions", localField: "deployment", foreignField: "deployment", as: "revisions" }).unwind({ path: "$deployment" }).next();

    if (!job) {
      res.status(404).send({ error: ErrorMessages.job.NOT_FOUND });
      return;
    }

    const revision = (job as JobDeploymentRevision).revisions.find(({ revision }) => revision === job.revision);

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