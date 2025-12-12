import { Db } from "mongodb";

import {
  createCollectionListener,
  CollectionListener,
} from "../../client/listener/index.js";
import { strategyListeners } from "../../strategies/index.js";
import { NosanaCollections } from "../../definitions/collection.js";

import type { JobsDocument } from "../../types/index.js";

export function startJobsCollectionListener(db: Db) {
  const listener: CollectionListener<JobsDocument> =
    createCollectionListener(NosanaCollections.JOBS, db);

  strategyListeners.jobs.forEach(([eventType, callback, options]) => {
    if (eventType === "insert") {
      listener.addListener(
        eventType,
        (doc, db) => callback(doc, db),
      );
    } else {
      listener.addListener(eventType, callback, options);
    }
  });

  listener.start();
}
