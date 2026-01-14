import type { Db } from "mongodb";
import type { Job, Market } from "@nosana/kit";
import { MarketQueueType, MonitorEventType } from "@nosana/kit";
import { address } from "@solana/addresses";

import { getKit } from "../../kit/index.js";
import { convertJobState } from "./convertJobState.js";
import { NosanaCollections } from "../../definitions/collection.js";
import { updateAllUnfinishedJobs } from "./updateAllUnfinishedJobs.js";

import { JobState, type JobsDocument, type DeploymentDocument } from "../../types/index.js";

async function findQueuedJobsByMarket(
  db: Db,
  marketAddress: string
): Promise<JobsDocument[]> {
  const jobsCollection = db.collection<JobsDocument>(NosanaCollections.JOBS);
  const deploymentsCollection = db.collection<DeploymentDocument>(NosanaCollections.DEPLOYMENTS);

  // Find all deployments for this market
  const deployments = await deploymentsCollection
    .find({ market: marketAddress })
    .project({ id: 1 })
    .toArray();

  const deploymentIds = deployments.map((d) => d.id);

  if (deploymentIds.length === 0) {
    return [];
  }

  // Find all queued jobs for these deployments
  const queuedJobs = await jobsCollection
    .find({
      deployment: { $in: deploymentIds },
      state: JobState.QUEUED,
    })
    .toArray();

  return queuedJobs;
}

async function checkJobExists(kit: ReturnType<typeof getKit>, jobAddress: string): Promise<boolean> {
  try {
    await kit.jobs.get(address(jobAddress));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message === "Account does not exist or has no data") {
      return false;
    }
    // Re-throw other errors
    throw error;
  }
}

async function handleJobUpdate(
  db: Db,
  jobData: Job
): Promise<void> {
  const jobsCollection = db.collection<JobsDocument>(NosanaCollections.JOBS);
  const { address, state, timeStart } = jobData;

  await jobsCollection.updateOne(
    {
      job: address.toString(),
      state: { $nin: [JobState.COMPLETED, JobState.STOPPED] } // required to ensure states don't regress
    },
    { $set: { state: convertJobState(state), time_start: Number(timeStart) } },
    { upsert: false }
  );
}

async function handleMarketUpdate(
  db: Db,
  marketAccount: Market
): Promise<void> {
  const kit = getKit();
  const jobsCollection = db.collection<JobsDocument>(NosanaCollections.JOBS);
  const marketAddress = marketAccount.address.toString();

  const queuedJobsFromDB = await findQueuedJobsByMarket(db, marketAddress);

  // Check if all our queued jobs in this market are actually still queued on-chain
  // A delist instruction can remove the job from the on-chain queue
  if (queuedJobsFromDB && queuedJobsFromDB.length) {
    let removeJobsFromDb: string[] = [];

    if (
      marketAccount.queueType === MarketQueueType.NODE_QUEUE ||
      !marketAccount.queue.length
    ) {
      // If the market is a node queue or has no queue, remove all jobs from the database
      removeJobsFromDb = queuedJobsFromDB.map((j) => j.job);
    } else {
      // Check which jobs are not in queue anymore
      const queueAddresses = marketAccount.queue.map((addr) => addr.toString());
      removeJobsFromDb = queuedJobsFromDB
        .filter((j) => !queueAddresses.includes(j.job))
        .map((j) => j.job);
    }

    if (removeJobsFromDb.length) {
      // Check if these jobs don't exist on-chain anymore before updating them (they could also be running or completed)
      for (let i = 0; i < removeJobsFromDb.length; i++) {
        try {
          const exists = await checkJobExists(kit, removeJobsFromDb[i]);
          if (!exists) {
            console.log(
              `Could not find queued job ${removeJobsFromDb[i]} on-chain, it was probably delisted, updating state to STOPPED..`
            );
            await jobsCollection.updateOne(
              { job: removeJobsFromDb[i] },
              { $set: { state: JobState.STOPPED } }
            );
          }
        } catch (e: unknown) {
          console.log('Could not check job account on-chain', e);
        }
      }
    }
  }
}

export async function startJobAccountsListeners(db: Db) {
  const kit = getKit();

  updateAllUnfinishedJobs(kit, db).catch(console.error);

  const [stream, stop] = await kit.jobs.monitor();

  process.on('SIGINT', () => {
    stop();
    process.exit();
  });

  for await (const { type, data } of stream) {
    switch (type) {
      case MonitorEventType.MARKET:
        await handleMarketUpdate(db, data as Market).catch(console.error);
        break;
      case MonitorEventType.JOB:
        if (data.state === 0) break; // Skip queued jobs (state 0)
        await handleJobUpdate(db, data as Job).catch(console.error);
        break;
    }
  }
}