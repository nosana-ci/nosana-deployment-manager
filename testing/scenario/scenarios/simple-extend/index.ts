import { basicFlowScenario } from './basic-flow.js';
import { finishBeforeExtendScenario } from './finish-before-extend.js';
import { queuedWithoutHostScenario } from './queued-without-host.js';
import { queueThenJoinScenario } from './queue-then-join.js';

basicFlowScenario();
finishBeforeExtendScenario();
queuedWithoutHostScenario();
queueThenJoinScenario();
