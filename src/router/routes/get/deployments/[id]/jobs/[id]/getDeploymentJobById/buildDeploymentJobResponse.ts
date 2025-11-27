import type { NosanaApiGetJobByAddressResponse } from "@nosana/kit"

import { getKit } from "../../../../../../../../kit/index.js";

import type { DeploymentJobByIdSuccess } from "../../../../../../../schema/get/index.schema.js";
import type { DeploymentAggregation, JobResultsDocument, JobsDocument, RevisionDocument } from "../../../../../../../../types/index.js";

export async function buildDeploymentJobResponse(
  deployment: DeploymentAggregation,
  job: JobsDocument,
  revision: RevisionDocument,
  results: JobResultsDocument | null,
  jobData: NosanaApiGetJobByAddressResponse
): Promise<DeploymentJobByIdSuccess> {
  const kit = getKit();

  let jobResponse = {
    confidential: deployment.confidential,
    revision: job.revision,
    market: deployment.market,
    node: jobData.node,
    state: jobData.state,
    jobStatus: jobData.jobStatus,
    jobDefinition: revision.job_definition,
    jobResult: results ? results.results : null,
    timeStart: jobData.timeStart,
    timeEnd: jobData.timeEnd,
    listedAt: jobData.listedAt,
  }

  if (jobData.state > 1 && jobResponse.jobResult === null && jobData.ipfsResult) {
    jobResponse.jobResult = await kit.ipfs.retrieve<DeploymentJobByIdSuccess>(jobData.ipfsResult);
  }

  return jobResponse
}
