import type { Collection } from "mongodb";

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

export type DeploymentStatus = (typeof DeploymentStatus)[keyof typeof DeploymentStatus];

export const DeploymentStrategy = {
  SIMPLE: "SIMPLE",
  "SIMPLE-EXTEND": "SIMPLE-EXTEND",
  SCHEDULED: "SCHEDULED",
  INFINITE: "INFINITE",
} as const;

export type DeploymentStrategy = (typeof DeploymentStrategy)[keyof typeof DeploymentStrategy];

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

export const DeploymentDocumentFields: Record<
  Uppercase<keyof DeploymentDocument>,
  keyof DeploymentDocument
> = {
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
  RAPID_STREAK: "rapid_streak",
  NEXT_RETRY_AT: "next_retry_at",
};

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
  /**
   * Consecutive rapid-completion rounds (INFINITE): each rapid round throttles
   * the next LIST with an escalating cooldown; reset by a healthy job. At
   * `rapid_completion_max_streak` the deployment is stopped to protect funds.
   */
  rapid_streak?: number;
  /**
   * When a transiently-failing task is next due to retry (a handled
   * LIST/EXTEND/STOP error or a rapid-completion throttle). Soft, for UI/tracing
   * only — the deployment stays RUNNING while it waits; cleared on success.
   */
  next_retry_at?: Date;
};

export type Endpoint = {
  opId: string;
  port: number | string;
  url: string;
};
