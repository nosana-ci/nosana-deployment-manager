import type { WithId } from "mongodb";

import type {
  DeploymentCollection,
  DeploymentDocument,
  EventsCollection,
  JobResultsCollection,
  JobsCollection,
  RevisionCollection,
  TasksCollection,
  VaultCollection,
  VaultDocument,
} from "./index.js";
import type { DeploymentWatchers } from "../router/stream/deploymentWatchers.js";

// A module (not a .d.ts) on purpose: skipLibCheck silences broken imports in
// declaration files, which would quietly turn these properties into `any`.
declare module "fastify" {
  interface FastifyReply {
    _locals?: {};
    locals: {
      deployment?: WithId<DeploymentDocument>;
      vault?: VaultDocument;
      deploymentWatchers: DeploymentWatchers;
      db: {
        deployments: DeploymentCollection;
        events: EventsCollection;
        vaults: VaultCollection;
        jobs: JobsCollection;
        tasks: TasksCollection;
        revisions: RevisionCollection;
        results: JobResultsCollection;
      };
    };
  }
}
