import { Collections, DeploymentDocument, EventDocument, VaultDocument, JobsDocument, TaskDocument, RevisionDocument, JobResultsDocument } from "../types/index.js";

export const NosanaCollections = {
  DEPLOYMENTS: "deployments",
  EVENTS: "events",
  VAULTS: "vaults",
  JOBS: "jobs",
  TASKS: "tasks",
  REVISIONS: "revisions",
  RESULTS: "results"
} as const;

export type NosanaCollectionName = keyof typeof NosanaCollections;

export const CollectionsNames: Array<keyof Collections> = Object.values(NosanaCollections);

// Map collection names to their document types for repository pattern
export type CollectionsMap = {
  deployments: DeploymentDocument;
  events: EventDocument;
  vaults: VaultDocument;
  jobs: JobsDocument;
  tasks: TaskDocument;
  revisions: RevisionDocument;
  results: JobResultsDocument;
};
