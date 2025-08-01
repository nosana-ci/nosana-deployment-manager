import {
  DeploymentAggregation,
  DeploymentCollection,
  EventsCollection,
  JobsCollection,
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
      };
    };
  }
}
