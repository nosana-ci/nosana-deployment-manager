import type { Collection } from "mongodb";
import type { JobDefinition } from "@nosana/kit";

export type RevisionDocument = {
  revision: number;
  deployment: string;
  /**
   * The pin a job for this revision posts — `job_definition` with the
   * deployment's SSH keys merged in when it has any. NOT necessarily the hash
   * of `job_definition` itself, and not immutable: every write that activates
   * a revision or changes the keys re-pins the ACTIVE revision's hash, so the
   * LIST path can post it blindly. A non-active revision's hash may embed the
   * keys from when it was last active; activation refreshes it.
   */
  ipfs_definition_hash: string;
  /** The definition as stored — always WITHOUT `ssh` (split off at write time). */
  job_definition: JobDefinition;
  created_at: Date;
};

export type RevisionCollection = Collection<RevisionDocument>;
