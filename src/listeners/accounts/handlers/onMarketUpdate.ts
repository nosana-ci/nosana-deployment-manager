import type { Db } from "mongodb";
import { type Market, MarketQueueType } from "@nosana/kit";

import { getKit } from "../../../kit/index.js";
import { NosanaCollections } from "../../../definitions/collection.js";
import { checkJobExists, findQueuedJobsByMarket } from "../helpers/index.js";

import { type JobsDocument, JobState } from "../../../types/index.js";

const isJobQueuedAndNotEmpty = (market: Market) => market.queueType === MarketQueueType.JOB_QUEUE || !market.queue.length;

export async function onMarketUpdate(
  db: Db,
  marketAccount: Market
): Promise<void> {
  const kit = getKit();
  const marketAddress = marketAccount.address.toString();
  const jobsCollection = db.collection<JobsDocument>(NosanaCollections.JOBS);

  const queuedJobsFromDB = await findQueuedJobsByMarket(db, marketAddress);

  if (queuedJobsFromDB.size === 0) return;

  // Check if all our queued jobs in this market are actually still queued on-chain
  // A delist instruction can remove the job from the on-chain queue
  if (isJobQueuedAndNotEmpty(marketAccount)) {
    for (const address of marketAccount.queue) {
      if (queuedJobsFromDB.has(address.toString())) {
        queuedJobsFromDB.delete(address.toString());
      }
    }
  }

  if (queuedJobsFromDB.size > 0) {
    try {
      for (const jobAddress of queuedJobsFromDB) {
        if (await checkJobExists(kit, jobAddress)) {
          queuedJobsFromDB.delete(jobAddress);
        }
      }

      await jobsCollection.updateMany(
        { job: { $in: Array.from(queuedJobsFromDB) } },
        { $set: { state: JobState.STOPPED } }
      );

    } catch (e: unknown) {
      console.log('Could not check job account on-chain', e);
    }

  }

}