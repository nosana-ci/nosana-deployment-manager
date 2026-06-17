import type { Collection } from "mongodb";
import type { JobDefinition } from "@nosana/kit";

export type RevisionDocument = {
  revision: number;
  deployment: string;
  ipfs_definition_hash: string;
  job_definition: JobDefinition;
  created_at: Date;
};

export type RevisionCollection = Collection<RevisionDocument>;
