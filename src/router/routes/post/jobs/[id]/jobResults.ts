import { RouteHandler } from "fastify";

import { ErrorMessages } from "../../../../../errors/index.js";

import type { JobResultsSchema } from "../../../../schema/index.schema.js";
import type { JobResultsPostHandlerSuccess, JobResultsPostHandlerError } from "../../../../schema/post/index.schema.js";

export const jobResultsPostHandler: RouteHandler<{
  Params: { job: string };
  Body: JobResultsSchema;
  Reply: JobResultsPostHandlerSuccess | JobResultsPostHandlerError;
}> = async (req, res) => {
  const { db } = res.locals;
  const jobId = req.params.job;

  try {
    const results = await db.results.findOne({ job: { $eq: jobId } });

    if (results) {
      res.status(400).send({ error: ErrorMessages.job.JOB_ALREADY_COMPLETED })
      return;
    }

    const { acknowledged } = await db.results.insertOne({ job: jobId, results: req.body });

    if (!acknowledged) {
      res.status(400).send({ error: ErrorMessages.job.FAILED_TO_SAVE_RESULTS })
      return
    }

    res.status(200).send({ message: "Success" });
  } catch (error) {
    res.log.error(error);
    res
      .status(500)
      .send({ error: ErrorMessages.generic.SOMETHING_WENT_WRONG });
  }
}