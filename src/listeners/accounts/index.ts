import type { Db } from "mongodb";
import type { Job, Market } from "@nosana/kit";
import { MonitorEventType } from "@nosana/kit";

import { getKit } from "../../kit/index.js";
import { onJobUpdate, onMarketUpdate } from "./handlers/index.js";
import { updateAllUnfinishedJobs } from "./updateAllUnfinishedJobs.js";

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
        await onMarketUpdate(db, data as Market).catch(console.error);
        break;
      case MonitorEventType.JOB:
        if (data.state === 0) break; // Skip queued jobs (state 0)
        await onJobUpdate(db, data as Job).catch(console.error);
        break;
    }
  }
}