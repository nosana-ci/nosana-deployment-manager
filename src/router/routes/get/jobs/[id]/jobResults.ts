import { RouteHandler } from "fastify";

import { ErrorMessages } from "../../../../../errors/index.js";

import type { JobResultsHandlerSuccess, JobResultsHandlerError } from "../../../../schema/get/index.schema.js";

export const jobResultsHandler: RouteHandler<{
  Params: { job: string };
  Reply: JobResultsHandlerSuccess | JobResultsHandlerError;
}> = async (req, res) => {
  const { db } = res.locals;
  const jobId = req.params.job;

  try {
    const job = await db.jobs.findOne({
      job: {
        $eq: jobId
      }
    });

    if (!job) {
      res.status(404).send({ error: ErrorMessages.job.NOT_FOUND });
      return;
    }

    if (job.status !== "COMPLETED") {
      res.status(400).send({ error: ErrorMessages.job.JOB_NOT_COMPLETED });
      return;
    }

    const results = await db.results.findOne({
      job: {
        $eq: jobId
      }
    })

    if (!results) {
      res.status(404).send({ error: ErrorMessages.job.JOB_RESULTS_NOT_FOUND })
      return
    }

    res.status(200).send(results.results);
  } catch (error) {
    res.log.error(error);
    res
      .status(500)
      .send({ error: ErrorMessages.generic.SOMETHING_WENT_WRONG });
  }
}