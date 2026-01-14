import { basicFlowScenario } from './basic-flow.js';
import { joinQueueBeforePostedScenario } from './join-queue-before-posted.js';
import { finishJobPrematurelyScenario } from './finish-job-prematurely.js';
import { multipleReplicasScenario } from './multiple-replicas.js';

basicFlowScenario();
joinQueueBeforePostedScenario();
finishJobPrematurelyScenario();
multipleReplicasScenario();
