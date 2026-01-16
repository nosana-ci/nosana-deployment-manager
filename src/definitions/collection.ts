import { Collections } from "../types/index.js";

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

export const CollectionsNames: Array<keyof Collections> = Object.values(NosanaCollections)
