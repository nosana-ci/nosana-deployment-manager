import { NosanaCollections } from "../../definitions/collection.js";
import { resyncParkedListTasks } from "../../tasks/task/list/reserve.js";

import { OnEvent, type StrategyListener } from "../../client/listener/types.js";
import { type DeploymentDocument, DeploymentDocumentFields, type TaskDocument } from "../../types/index.js";

/**
 * A deployment's market or requirements changed: its LIST tasks parked on a
 * reservation request made on the old terms are made due now. Each run renews
 * with the new terms, host-manager answers 409 for the old key, and the run
 * hands its jobs to a new LIST task that asks on the new terms; the old request
 * is cancelled when the task is deleted.
 */
export const deploymentReservationTermsUpdate: StrategyListener<DeploymentDocument> = [
  OnEvent.UPDATE,
  ({ id }, db) => {
    void resyncParkedListTasks(db.collection<TaskDocument>(NosanaCollections.TASKS), { deploymentId: id });
  },
  {
    fields: [DeploymentDocumentFields.MARKET, DeploymentDocumentFields.REQUIREMENTS],
  },
];
