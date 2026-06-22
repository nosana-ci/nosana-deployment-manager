import type { NosanaNetwork } from "@nosana/kit";

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
  client_manager_url: string | undefined;
  docdb: {
    hostname: string;
    port: string | number;
    username: string | undefined;
    password: string | undefined;
    use_tls: boolean;
    dbname: string;
  };
  default_minutes_before_timeout: number;
  rapid_completion_job_count: number;
  rapid_completion_threshold_minutes: number;
  /**
   * Visibility timeout: how long a claimed task stays hidden before another
   * consumer may reclaim it. Set once at claim (no renewal) — sized above
   * worst-case task time. Correctness rides on per-tx idempotency, not on this,
   * so a task that outruns the lease is safe (just wasteful) if reclaimed.
   */
  task_lease_ms: number;
  /** Crash-loop guard: claims beyond this are abandoned (Phase 1 = deleted). */
  task_max_attempts: number;
  /**
   * Bound on consecutive in-flight retries (API-path IN_PROGRESS / transient
   * 5xx / lost response). These are legitimate waits, not crashes, so they do
   * NOT count against `task_max_attempts`; this separate, more generous cap stops
   * a stuck key or a CM outage from retrying forever.
   */
  task_max_inflight_retries: number;
  /** How often the parent polls a sent transaction's confirmation status. */
  task_confirm_poll_interval_ms: number;
};
