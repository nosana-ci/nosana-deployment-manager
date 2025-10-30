import { getSdk } from "../../../../../../../../sdk/index.js";

import type { GetJobByAddressResponse } from "@nosana/sdk/dist/services/api/types"
import type { JobResultsSchema } from "../../../../../../../schema/index.schema.js";
import type { DeploymentAggregation, JobResultsDocument, JobsDocument, RevisionDocument } from "../../../../../../../../types/index.js";

export async function buildDeploymentJobResponse(
  deployment: DeploymentAggregation,
  job: JobsDocument,
  revision: RevisionDocument,
  results: JobResultsDocument | null,
  jobData: GetJobByAddressResponse
) {
  const sdk = getSdk();
  let jobResponse = {
    confidential: deployment.confidential,
    revision: job.revision,
    market: deployment.market,
    node: jobData.node,
    state: jobData.state,
    jobStatus: jobData.jobStatus,
    jobResult: results ? results.results : null,
    jobDefinition: revision.job_definition,
    timeStart: jobData.timeStart,
    timeEnd: jobData.timeEnd,
    listedAt: jobData.listedAt,
  }

  if (!jobResponse.confidential && jobResponse.jobResult !== null && jobData.ipfsResult) {
    jobResponse.jobResult = await sdk.ipfs.retrieve(jobData.ipfsResult) as JobResultsSchema;
  }

  return jobResponse
}
