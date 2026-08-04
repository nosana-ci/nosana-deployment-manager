import type { DeploymentCollection } from "./deployment.js";
import type { EventsCollection } from "./event.js";
import type { VaultCollection } from "./vault.js";
import type { RevisionCollection } from "./revision.js";
import type { JobsCollection, JobResultsCollection } from "./job.js";
import type { TasksCollection, DeploymentLocksCollection } from "./task.js";
import type { FrpsStreamCursorCollection, FrpsEndpointStatusCollection } from "./frps.js";

export type Collections = {
  deployments: DeploymentCollection;
  events: EventsCollection;
  vaults: VaultCollection;
  tasks: TasksCollection;
  task_locks: DeploymentLocksCollection;
  jobs: JobsCollection;
  revisions: RevisionCollection;
  results: JobResultsCollection;
  frps_stream_cursor: FrpsStreamCursorCollection;
  frps_endpoint_status: FrpsEndpointStatusCollection;
};
