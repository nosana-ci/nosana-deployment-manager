import type { AnyBulkWriteOperation, Db } from "mongodb";
import { createNosanaApi } from "@nosana/kit";

import { getConfig } from "../../../config/index.js";
import { NosanaCollections } from "../../../definitions/collection.js";

import type { DeploymentDocument } from "../../../types/index.js";
import type { DeploymentRequirements } from "../../../router/schema/components/requirements.schema.js";

/**
 * A deployment made for one GPU with no market (the dashboard's requirements
 * flow, before it pinned the GPU's market) gets that market: the first one
 * host-manager's GPU catalogue lists the model in, as the dashboard pins it.
 * A LIST then lists straight into the market's queue instead of reserving a
 * node (see `runListTask`: nodes that join a queue holding listed jobs never
 * reach a reservation). The requirements stay as they are.
 *
 * Left as they are, and counted in the log: a deployment naming several GPUs
 * (it keeps reserving), and one whose GPU the catalogue does not list (no host
 * has it now, so there is no market to name).
 */
export default async function pinSingleGpuDeploymentsToMarket(db: Db): Promise<void> {
  const deployments = db.collection<DeploymentDocument>(NosanaCollections.DEPLOYMENTS);
  const candidates = await deployments
    .find({ market: null, "requirements.name": { $exists: true } }, { projection: { id: 1, requirements: 1 } })
    .toArray();
  if (candidates.length === 0) return;

  // host-manager's GPU catalogue: each model as hosts report it, and the open markets it is found in.
  const { network, host_manager_url } = getConfig();
  const api = createNosanaApi(network, undefined, { ...(host_manager_url && { host_manager_url }) });
  const { gpus } = await api.reservations.listGpus();

  const marketsByGpu = new Map<string, string[]>();
  for (const gpu of gpus) {
    // A model hosts report with several VRAM sizes has a row per size.
    marketsByGpu.set(gpu.name, [...new Set([...(marketsByGpu.get(gpu.name) ?? []), ...gpu.markets])]);
  }

  const writes: AnyBulkWriteOperation<DeploymentDocument>[] = [];
  const unlisted: string[] = [];
  let several = 0;
  for (const { id, requirements } of candidates) {
    const gpu = singleGpuOf(requirements);
    if (gpu === null) {
      several++;
      continue;
    }
    const market = marketsByGpu.get(gpu)?.[0];
    if (market === undefined) {
      unlisted.push(`${id} (${gpu})`);
      continue;
    }
    // Only while still unpinned: an owner may have set a market meanwhile.
    writes.push({ updateOne: { filter: { id, market: null }, update: { $set: { market } } } });
  }
  if (writes.length > 0) await deployments.bulkWrite(writes);

  console.log(
    `Pinned ${writes.length} single-GPU deployment(s) to their market; ` +
      `${several} naming several GPUs left to reserve; ` +
      `${unlisted.length} with a GPU no host has now left unpinned${unlisted.length ? `: ${unlisted.join(", ")}` : ""}`
  );
}

/** The one GPU model the requirements name (a value or a list of one), else null. */
export function singleGpuOf(requirements: DeploymentRequirements | null | undefined): string | null {
  const value = requirements?.name;
  if (value === undefined) return null;
  const names = Array.isArray(value) ? value : [value];
  return names.length === 1 && typeof names[0] === "string" ? names[0] : null;
}
