import { Wallet } from "@coral-xyz/anchor";
import { AuthorizationManager } from "@nosana/sdk";
import { Keypair, PublicKey } from "@solana/web3.js";

import type { RouteHandler } from "fastify";
import type { HeadersSchema } from "../../schema/index.schema.js";
import { getSdk } from "../../../sdk/index.js";
import { ErrorMessages } from "../../../errors/index.js";

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

    const authorizationManager = new AuthorizationManager(
      new Wallet(new Keypair())
    );

    const authToken = req.headers.authorization;

    if (typeof authToken !== "string") {
      res.status(401).send("Unauthorized");
      return;
    }

    const sdk = getSdk();
    try {
      const job = await sdk.jobs.get(req.params.job);

      if (!job) {
        res.status(404).send("Job Not Found");
        return;
      }

      if (!['RUNNING', "STOPPED"].includes(job.state as string) && job.node !== '11111111111111111111111111111111') {
        res.status(403).send("Job must be running");
        return;
      }

      if (
        !authorizationManager.validateHeader(req.headers, {
          publicKey: new PublicKey(job.node),
          expected_message: req.params.job,
          expiry: 300,
        })
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
