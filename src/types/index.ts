import type { Collection, Document } from "mongodb";
import type { NosanaNetwork, FlowState, JobDefinition } from "@nosana/kit";

import type { JobResultsSchema } from "../router/schema/index.schema.js";

export type DeploymentsConfig = {
  base_url: string;
  network: NosanaNetwork;
  nos_address: string;
  rpc_network: string;
  frps_address: string;
  tasks_batch_size: number;
  confidential_ipfs_pin: string;
  confidential_by_default: boolean;
  deployment_manager_port: number;
  vault_key: string | undefined;
  dashboard_backend_url: string | undefined;
  docdb: {
    hostname: string;
    port: string | number;
    username: string | undefined;
    password: string | undefined;
    use_tls: boolean;
  };
  default_minutes_before_timeout: number;
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
    rotation_time?: never;
  } & DeploymentDocumentBase)
  | ({
    strategy: "INFINITE";
    rotation_time: number;
    schedule?: never;
  } & DeploymentDocumentBase)
  | ({
    strategy: Exclude<DeploymentStrategy, "SCHEDULED">;
    schedule?: never;
    rotation_time?: never;
  } & DeploymentDocumentBase);

export const DeploymentDocumentFields: Record<Uppercase<keyof DeploymentDocument>, keyof DeploymentDocument> = {
  ID: "id",
  VAULT: "vault",
  MARKET: "market",
  OWNER: "owner",
  NAME: "name",
  STATUS: "status",
  REPLICAS: "replicas",
  TIMEOUT: "timeout",
  ENDPOINTS: "endpoints",
  ACTIVE_REVISION: "active_revision",
  CONFIDENTIAL: "confidential",
  CREATED_AT: "created_at",
  UPDATED_AT: "updated_at",
  STRATEGY: "strategy",
  SCHEDULE: "schedule",
  ROTATION_TIME: "rotation_time",
}

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
  created_at: Date;
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
  active_jobs: number;
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
  tx: string | undefined | null;
  active_revision?: number;
  limit?: number;
  job?: string;
  created_at: Date;
};

export type TasksCollection = Collection<TaskDocument>;

export const JobState = {
  QUEUED: "QUEUED",
  RUNNING: "RUNNING",
  COMPLETED: "COMPLETED",
  STOPPED: "STOPPED",
} as const;

export type JobState = (typeof JobState)[keyof typeof JobState];

export const JobsDocumentFields: Record<Uppercase<keyof JobsDocument>, keyof JobsDocument> = {
  JOB: "job",
  MARKET: "market",
  DEPLOYMENT: "deployment",
  REVISION: "revision",
  TX: "tx",
  STATE: "state",
  TIME_START: "time_start",
  CREATED_AT: "created_at",
  UPDATED_AT: "updated_at",
}

export type JobsDocument = {
  job: string;
  market: string;
  deployment: string;
  revision: number;
  tx: string;
  state: JobState;
  time_start: number;
  created_at: Date;
  updated_at: Date;
};

export type JobsCollection = Collection<JobsDocument>;

export type ResultsDocument = {
  job: string;
  results: FlowState;
}

export type ResultsCollection = Collection<ResultsDocument>;

export interface WorkerEventMessage {
  event: "CONFIRMED" | string;
  error?: string;
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

export type WorkerData = {
  task: OutstandingTasksDocument;
  vault: string;
  confidential_ipfs_pin: string;
};

export type TaskFinishedReason = "COMPLETED" | "FAILED" | "TIMEOUT";