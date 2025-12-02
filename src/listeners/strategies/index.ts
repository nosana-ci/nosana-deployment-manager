import {
  deploymentReplicaUpdate,
  deploymentRevisionUpdate,
  deploymentStatusStartingUpdate,
  deploymentStatusStoppingUpdate
} from "./all/index.js"
import { infiniteJobRunningUpdate, infiniteJobStateCompletedOrStopUpdate } from "./infinite/index.js";
import { deploymentScheduleUpdate } from "./scheduled/index.js";
import { simpleExtendedJobRunningUpdate } from "./simple-extended/index.js";

import type { StrategyListener } from "../../client/listener/types.js";
import type { DeploymentDocument, JobsDocument } from "../../types/index.js";

interface StrategyListeners {
  deployments: StrategyListener<DeploymentDocument>[];
  jobs: StrategyListener<JobsDocument>[];
}

export const strategyListeners: StrategyListeners = {
  deployments: [
    deploymentReplicaUpdate,
    deploymentRevisionUpdate,
    deploymentStatusStartingUpdate,
    deploymentStatusStoppingUpdate,
    deploymentScheduleUpdate
  ],
  jobs: [
    simpleExtendedJobRunningUpdate,
    infiniteJobRunningUpdate,
    infiniteJobStateCompletedOrStopUpdate
  ]
}