import type { NosanaNetwork } from "@nosana/kit";

export type DeploymentsConfig = {
  base_url: string;
  network: NosanaNetwork;
  nos_address: string;
  rpc_network: string;
  /**
   * Explicit WebSocket (subscriptions) endpoint. Leave undefined for
   * devnet/mainnet so the kit derives wss:// from the https rpc endpoint. Set it
   * for localnet, where the kit's profile hardcodes ws://127.0.0.1:8900 — wrong
   * from inside the worker container, which reaches the validator over
   * host.docker.internal.
   */
  ws_network: string | undefined;
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
   * 5xx / lost response) AND the now-retryable handled task errors. These are
   * legitimate waits, not crashes, so they do NOT count against
   * `task_max_attempts`. Exceeding a *finite* value abandons the task to ERROR;
   * set to `0` to disable the cap and retry forever at the capped cooldown.
   */
  task_max_inflight_retries: number;
  /** How often the parent polls a sent transaction's confirmation status. */
  task_confirm_poll_interval_ms: number;
  /**
   * Escalating-backoff ladder for retrying a transient task failure (a handled
   * LIST/EXTEND/STOP error or an in-flight wait): the deployment stays RUNNING
   * and the task is rescheduled after `min(base · multiplier^retries, max)`.
   */
  retry_cooldown_base_ms: number;
  retry_cooldown_max_ms: number;
  retry_cooldown_multiplier: number;
  /**
   * Longer ladder used when a failure is `InsufficientFundsForRent`: the vault
   * may be topped up, so retry on a slower cadence (the deployment shows
   * INSUFFICIENT_FUNDS while it waits).
   */
  insufficient_funds_cooldown_base_ms: number;
  insufficient_funds_cooldown_max_ms: number;
  insufficient_funds_cooldown_multiplier: number;
  /**
   * Throttle ladder for the rapid-completion fail-safe: instead of stopping an
   * INFINITE deployment whose jobs complete too fast, delay the next LIST round
   * by `min(base · multiplier^streak, max)`. After `rapid_completion_max_streak`
   * consecutive rapid rounds the deployment is stopped to protect funds; set the
   * streak cap to `0` to throttle forever and never stop.
   */
  rapid_completion_cooldown_base_ms: number;
  rapid_completion_cooldown_max_ms: number;
  rapid_completion_cooldown_multiplier: number;
  rapid_completion_max_streak: number;
};
