import type { AnyBulkWriteOperation, Db } from "mongodb";

import { BULK_WRITE_BATCH_SIZE } from "../../index.js";
import { NosanaCollections } from "../../../definitions/collection.js";
import {
  type DeploymentDocument,
  type FrpsEndpointStatusDocument,
  type JobsDocument,
  JobState,
} from "../../../types/index.js";

/**
 * Backfills `online` onto every stored endpoint.
 *
 * Not optional: the deployment response schema requires the field, so a
 * deployment written before it existed fails serialization outright — the read
 * routes answer 500, not a missing key.
 *
 * The value is computed rather than defaulted to `false`, because a deployment
 * that is serving right now would otherwise read offline until its next tunnel or
 * job event, which for a healthy long-running deployment can be a whole rotation
 * away. Same rule the listeners apply: a tunnel FRPS has seen come up, on a job
 * still RUNNING on chain.
 *
 * Writes only where the field is absent — the `$exists: false` array filter makes
 * this idempotent and stops it overwriting a value a listener has already set.
 * `updated_at` is deliberately untouched: it marks configuration changes, and
 * `infiniteJobStateCompletedOrStopUpdate` selects recent jobs by it.
 */
export default async function migrateEndpointsToOnline(db: Db) {
  console.log("Backfilling endpoint online status...");

  const deployments = db.collection<DeploymentDocument>(NosanaCollections.DEPLOYMENTS);

  const pending = await deployments
    .find({ endpoints: { $elemMatch: { online: { $exists: false } } } })
    .project<{ id: string }>({ id: 1 })
    .toArray();

  if (pending.length === 0) return;

  const deploymentIds = pending.map(({ id }) => id);

  const [running, up] = await Promise.all([
    db
      .collection<JobsDocument>(NosanaCollections.JOBS)
      .find({ deployment: { $in: deploymentIds }, state: JobState.RUNNING })
      .project<{ job: string }>({ job: 1 })
      .toArray(),
    db
      .collection<FrpsEndpointStatusDocument>(NosanaCollections.FRPS_ENDPOINT_STATUS)
      .find({ deploymentId: { $in: deploymentIds }, state: "up" })
      .toArray(),
  ]);

  const runningJobs = new Set(running.map(({ job }) => job));

  const onlineByDeployment = new Map<string, Set<string>>();
  for (const { deploymentId, job, opId } of up) {
    if (!deploymentId || !runningJobs.has(job)) continue;
    const bucket = onlineByDeployment.get(deploymentId);
    if (bucket) bucket.add(opId);
    else onlineByDeployment.set(deploymentId, new Set([opId]));
  }

  let batch: AnyBulkWriteOperation<DeploymentDocument>[] = [];

  const flush = async () => {
    if (batch.length === 0) return;
    await deployments.bulkWrite(batch);
    batch = [];
  };

  for (const id of deploymentIds) {
    // Checked before pushing: the pair below must not carry the batch past
    // DocumentDB's 1000-operation ceiling.
    if (batch.length + 2 > BULK_WRITE_BATCH_SIZE) await flush();

    const online = [...(onlineByDeployment.get(id) ?? [])];

    // Two updates per deployment: the reachable ops, then everything else.
    // `$in: []` matches nothing and `$nin: []` matches everything, so a
    // deployment with no live tunnel is filled in entirely by the second.
    batch.push(
      {
        updateOne: {
          filter: { id },
          update: { $set: { "endpoints.$[endpoint].online": true } },
          arrayFilters: [{ "endpoint.opId": { $in: online }, "endpoint.online": { $exists: false } }],
        },
      },
      {
        updateOne: {
          filter: { id },
          update: { $set: { "endpoints.$[endpoint].online": false } },
          arrayFilters: [{ "endpoint.opId": { $nin: online }, "endpoint.online": { $exists: false } }],
        },
      }
    );
  }

  await flush();

  console.log(`Backfilled endpoint online status on ${deploymentIds.length} deployment(s).`);
}
