import { Db } from "mongodb";

import {
  createCollectionListener,
  CollectionListener,
} from "../../client/listener/index.js";
import { strategyListeners } from "../../strategies/index.js";
import { NosanaCollections } from "../../definitions/collection.js";

import type { DeploymentDocument } from "../../types/index.js";

export function startDeploymentCollectionListener(db: Db): { stop: () => Promise<void> } {
  const listener: CollectionListener<DeploymentDocument> =
    createCollectionListener(NosanaCollections.DEPLOYMENTS, db);

  strategyListeners.deployments.forEach(([eventType, callback, options]) => {
    if (eventType === "insert") {
      listener.addListener(
        eventType,
        (doc, db) => callback(doc, db),
      );
    } else {
      listener.addListener(eventType, callback, options);
    }
  });

  // Run the change-stream loop in the background; it resolves only when stop() is called.
  void listener.start();

  return { stop: () => listener.stop() };
}
