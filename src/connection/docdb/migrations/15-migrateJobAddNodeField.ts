import type { AnyBulkWriteOperation, Db } from "mongodb";
import { JobState as OnChainState } from "@nosana/kit";

import { getKit } from "../../../kit/index.js";
import { BULK_WRITE_BATCH_SIZE } from "../../index.js";
import { NosanaCollections } from "../../../definitions/collection.js";
import { JobState, type JobsDocument } from "../../../types/index.js";

export default async function migrateJobAddNodeField(db: Db) {
  const jobsCollection = db.collection<JobsDocument>(NosanaCollections.JOBS);

  const now = new Date();

  await jobsCollection.updateMany({}, { $set: { node: null, updated_at: now } });

  const runningJobs = await jobsCollection.find({ state: JobState.RUNNING }).toArray();

  if (runningJobs.length === 0) return;

  const kit = getKit();
  let batch: AnyBulkWriteOperation<JobsDocument>[] = [];

  const onchainRunningJobs = await kit.jobs.all({ state: OnChainState.RUNNING });

  const nodeMap = new Map<string, string>();

  onchainRunningJobs.forEach(({ address, node }) => {
    if (node) {
      nodeMap.set(address.toString(), node.toString());
    }
  });

  for (const { job } of runningJobs) {
    const node = nodeMap.get(job);

    if (!node) continue;

    batch.push({
      updateOne: {
        filter: { job },
        update: { $set: { node, updated_at: now } },
      },
    });

    if (batch.length === BULK_WRITE_BATCH_SIZE) {
      await jobsCollection.bulkWrite(batch, { ordered: false });
      batch = [];
    }
  }

  if (batch.length > 0) {
    await jobsCollection.bulkWrite(batch, { ordered: false });
  }
}