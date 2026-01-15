import { describe } from 'vitest';

import { basicFlowScenario } from './basic-flow.js';
import { finishJobPrematurelyScenario } from './finish-job-prematurely.js';
import { joinQueueBeforePostedScenario } from './join-queue-before-posted.js';
import { multipleReplicasScenario } from './multiple-replicas.js';

describe('Simple Strategy Scenarios', async () => {
  basicFlowScenario();
  finishJobPrematurelyScenario();
  joinQueueBeforePostedScenario();
  multipleReplicasScenario();
});
