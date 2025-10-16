import { FlowState, JobDefinition } from "@nosana/sdk";
import { Collection, Document } from "mongodb";

import { JobResultsSchema } from "../router/schema/index.schema.js";

export type DeploymentsConfig = {
  network: "mainnet" | "devnet";
  nos_address: string;
  rpc_network: string;
  frps_address: string;
  tasks_batch_size: number;
  confidential_by_default: boolean;
  deployment_manager_port: number;
  docdb: {
    hostname: string;
    port: string | number;
    username: string | undefined;
    password: string | undefined;
    use_tls: boolean;
  };
};

export const DeploymentStatus = {
  DRAFT: "DRAFT",
  ERROR: "ERROR",
  STARTING: "STARTING",
  RUNNING: "RUNNING",
  STOPPING: "STOPPING",
  STOPPED: "STOPPED",
  INSUFFICIENT_FUNDS: "INSUFFICIENT_FUNDS",
  ARCHIVED: "ARCHIVED",
} as const;

export type DeploymentStatus =
  (typeof DeploymentStatus)[keyof typeof DeploymentStatus];

export const DeploymentStrategy = {
  SIMPLE: "SIMPLE",
  "SIMPLE-EXTEND": "SIMPLE-EXTEND",
  SCHEDULED: "SCHEDULED",
  INFINITE: "INFINITE",
} as const;

export type DeploymentStrategy =
  (typeof DeploymentStrategy)[keyof typeof DeploymentStrategy];

export type DeploymentDocument =
  | ({
    strategy: "SCHEDULED";
    schedule: string;
  } & DeploymentDocumentBase)
  | ({
    strategy: Exclude<DeploymentStrategy, "SCHEDULED">;
    schedule?: never;
  } & DeploymentDocumentBase);

export type DeploymentCollection = Collection<DeploymentDocument>;

export type DeploymentDocumentBase = {
  id: string; // Deployment PublicKey
  vault: string; // Vault PublicKey
  market: string; // Market PublicKey
  owner: string; // Owners PublicKey
  name: string;
  status: DeploymentStatus;
  replicas: number;
  timeout: number;
  endpoints: Endpoint[];
  active_revision: number;
  confidential: boolean;
  created_at: Date;
  updated_at: Date;
};

export type Endpoint = {
  opId: string;
  port: number | string;
  url: string;
};

export const EventType = {
  DEPLOYMENT: "Deployment",
  EVENT: "Event",
} as const;

export type EventType = (typeof EventType)[keyof typeof EventType];

export type EventDocument = {
  category: EventType;
  deploymentId: string;
  type: string;
  message: string;
  tx?: string | undefined;
  created_at: Date;
};

export type EventsCollection = Collection<EventDocument>;

export type VaultDocument = {
  vault: string;
  vault_key: string;
  owner: string;
  sol: number;
  nos: number;
  nos_ata: string;
  created_at: Date;
  updated_at: Date;
};

export type VaultCollection = Collection<VaultDocument>;

export type RevisionDocument = {
  revision: number;
  deployment: string;
  ipfs_definition_hash: string;
  job_definition: JobDefinition;
  created_at: Date;
};

export type RevisionCollection = Collection<RevisionDocument>;

export type JobResultsDocument = {
  job: string;
  results: JobResultsSchema;
}

export type JobResultsCollection = Collection<JobResultsDocument>

export type Collections = {
  deployments: DeploymentCollection;
  events: EventsCollection;
  vaults: VaultCollection;
  tasks: TasksCollection;
  jobs: JobsCollection;
  revisions: RevisionCollection;
  results: JobResultsCollection;
};

export type DeploymentAggregation = DeploymentDocument & {
  events: EventDocument[];
  jobs: JobsDocument[];
  revisions: RevisionDocument[];
};

export const TaskType = {
  LIST: "LIST",
  EXTEND: "EXTEND",
  STOP: "STOP",
} as const;

export type TaskType = (typeof TaskType)[keyof typeof TaskType];

export type TaskDocument = {
  task: TaskType;
  due_at: Date;
  deploymentId: string;
  tx: string | undefined;
  created_at: Date;
};

export type TasksCollection = Collection<TaskDocument>;

export type JobsDocument = {
  job: string;
  deployment: string;
  revision: number;
  tx: string;
  status: "PENDING" | "CONFIRMED" | "COMPLETED";
  created_at: Date;
};

export type JobsCollection = Collection<JobsDocument>;

export type ResultsDocument = {
  job: string;
  results: FlowState;
}

export type ResultsCollection = Collection<ResultsDocument>;

export interface WorkerEventMessage {
  event: "CONFIRMED" | string;
  error?: string | object | Error | null;
  job: string;
  run: string;
  tx: string;
}

export type OutstandingTasksDocument = Document &
  TaskDocument & {
    deployment: Exclude<DeploymentDocument, "vault"> & {
      vault: VaultDocument;
    };
    jobs: JobsDocument[];
    revisions: RevisionDocument[];
  };
