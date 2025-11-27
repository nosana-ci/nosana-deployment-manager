
import { JobState } from "@nosana/kit";
import { address } from "@solana/addresses";

import type { RouteHandler } from "fastify";

import { ErrorMessages } from "../../../errors/index.js";
import { convertAddressToUnit8Array, getKit } from "../../../kit/index.js";

import type { HeadersSchema } from "../../schema/index.schema.js";

export const isJobHostRoute = (url: string, method: string) => url.startsWith("/api/deployments/jobs/") && !(method === "GET" && url.endsWith("results"))

export const authJobHostMiddleware: RouteHandler<{
  Params: { job: string };
  Headers: HeadersSchema;
}> = async (req, res) => {
  if (isJobHostRoute(req.url, req.method)) {
    if (req.params.job === undefined) {
      res.status(400).send("Bad Request");
      return;
    }


    const authToken = req.headers.authorization;

    if (typeof authToken !== "string") {
      res.status(401).send("Unauthorized");
      return;
    }

    const kit = getKit();

    try {
      const job = await kit.jobs.get(address(req.params.job));

      if (!job) {
        res.status(404).send("Job Not Found");
        return;
      }

      if (job.state !== JobState.RUNNING && job.node.toString() !== '11111111111111111111111111111111') {
        res.status(403).send("Job must be running");
        return;
      }

      if (
        !kit.authorization.validateHeaders(
          req.headers,
          convertAddressToUnit8Array(job.node),
          {
            expected_message: req.params.job,
            expiry: 300
          }
        )
      ) {
        res.status(401).send("Unauthorized");
        return;
      }
    } catch (error) {
      if (error instanceof Error && error.message === "Account does not exist or has no data") {
        res.status(404).send("Job Account not found");
        return
      }
      res.status(500).send(ErrorMessages.generic.SOMETHING_WENT_WRONG);
    }
  }
};
