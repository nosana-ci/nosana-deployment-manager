import type { Job } from "@nosana/kit";

import { getKit } from "../../../../../../../../kit/index.js";
import { jobStateToNumber } from "../../../../../../../../listeners/accounts/helpers/index.js";

import type { DeploymentJobByIdSuccess } from "../../../../../../../schema/get/index.schema.js";
import type { JobResultsSchema } from "../../../../../../../schema/index.schema.js";
import type { DeploymentDocument, JobResultsDocument, JobsDocument, RevisionDocument } from "../../../../../../../../types/index.js";

const DEFAULT_NODE_ADDRESS = "11111111111111111111111111111111";

/**
 * The job's lifecycle as the route reports it: the chain while the account
 * exists, otherwise our own record (kept by the accounts listener) — which is
 * all that remains of a delisted job.
 */
export function lifecycleOf(job: JobsDocument, onchain: Job | null) {
  if (onchain) {
    return {
      state: onchain.state as number,
      node: onchain.node as string,
      timeStart: Number(onchain.timeStart),
      timeEnd: Number(onchain.timeEnd),
      ipfsResult: onchain.ipfsResult,
    };
  }

  return {
    state: jobStateToNumber(job.state),
    node: job.node ?? DEFAULT_NODE_ADDRESS,
    timeStart: job.time_start,
    timeEnd: job.time_end ?? 0,
    ipfsResult: null,
  };
}

export async function buildDeploymentJobResponse(
  deployment: DeploymentDocument,
  job: JobsDocument,
  revision: RevisionDocument,
  results: JobResultsDocument | null,
  onchain: Job | null
): Promise<DeploymentJobByIdSuccess> {
  const { state, node, timeStart, timeEnd, ipfsResult } = lifecycleOf(job, onchain);

  let jobResult: JobResultsSchema | null = results ? results.results : null;
  // Nodes report results to us directly; fall back to what was pinned on-chain.
  if (state > 1 && jobResult === null && ipfsResult) {
    jobResult = await getKit().ipfs.retrieve<JobResultsSchema>(ipfsResult);
  }

  return {
    confidential: deployment.confidential,
    revision: job.revision,
    market: deployment.market,
    node,
    state,
    // The node-reported status only the dashboard indexer knew; we no longer ask it.
    jobStatus: null,
    jobDefinition: revision.job_definition,
    jobResult,
    timeStart,
    timeEnd,
    listedAt: Math.floor(job.created_at.getTime() / 1000),
  };
}
