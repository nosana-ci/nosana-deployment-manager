import { parentPort, workerData } from "worker_threads";

import { prepareWorker, signAuthHeader, workerErrorFormatter } from "../../../../../../worker/Worker.js";

import type { NosanaClient } from "@nosana/kit";

export type JobHeadersWorkerData = {
  vault: string;
  /** The running jobs' addresses; each is signed as its own header's message. */
  jobs: string[];
};

export type JobHeadersWorkerMessage =
  | { event: "GENERATED"; headers: Record<string, string> }
  | { event: "ERROR"; error: string };

/** The most messages the client manager signs in one call. */
const SIGN_BATCH_SIZE = 100;

/**
 * Signs the jobs' headers through the credential the vault holds. An API-key
 * vault signs at the client manager, so its jobs go up in batches of
 * SIGN_BATCH_SIZE rather than one round trip per job; a wallet signs locally.
 */
async function signJobHeaders(kit: NosanaClient, useNosanaApiKey: boolean, jobs: string[]): Promise<string[]> {
  if (!useNosanaApiKey) {
    return Promise.all(jobs.map((job) => signAuthHeader(kit, useNosanaApiKey, job, { includeTime: true })));
  }

  const headers: string[] = [];
  for (let start = 0; start < jobs.length; start += SIGN_BATCH_SIZE) {
    const batch = jobs.slice(start, start + SIGN_BATCH_SIZE);
    headers.push(...(await kit.api.auth.signHeaders(batch, { includeTime: true })));
  }
  return headers;
}

/**
 * Signs one timestamped header per job, with the job address as the message:
 * the node accepts a header only for the job it names, so one cannot be
 * replayed against another job. Runs in a worker because that is where the
 * vault key is decrypted.
 */
try {
  const { kit, useNosanaApiKey, jobs } = await prepareWorker<JobHeadersWorkerData>(workerData);

  const signed = await signJobHeaders(kit, useNosanaApiKey, jobs);

  parentPort!.postMessage({
    event: "GENERATED",
    headers: Object.fromEntries(jobs.map((job, index) => [job, signed[index]])),
  } satisfies JobHeadersWorkerMessage);
} catch (error) {
  parentPort!.postMessage({
    event: "ERROR",
    error: workerErrorFormatter(error),
  } satisfies JobHeadersWorkerMessage);
}
