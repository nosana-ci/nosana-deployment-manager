import {
  DeploymentAggregation,
  DeploymentCollection,
  EventsCollection,
  JobResultsCollection,
  JobsCollection,
  RevisionCollection,
  TasksCollection,
  VaultCollection,
  VaultDocument,
} from "./index.js";

declare module "fastify" {
  interface FastifyReply {
    _locals?: {};
    locals: {
      deployment?: DeploymentAggregation;
      vault?: VaultDocument;
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
