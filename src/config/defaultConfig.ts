import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { DeploymentsConfig } from "../types/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const commonConfig: Omit<
  DeploymentsConfig,
  | "network"
  | "nos_address"
  | "rpc_network"
  | "ws_network"
  | "frps_address"
  | "dashboard_backend_url"
> = {
  tasks_batch_size: process.env.TASKS_BATCH_SIZE
    ? parseInt(process.env.TASKS_BATCH_SIZE)
    : 10,
  deployment_manager_port: process.env.DEPLOYMENT_MANAGER_PORT
    ? parseInt(process.env.DEPLOYMENT_MANAGER_PORT)
    : 3001,
  confidential_by_default: process.env.CONFIDENTIAL_BY_DEFAULT === "true",
  vault_key: process.env.VAULT_KEY || undefined,
  confidential_ipfs_pin: "",
  base_url:
    process.env.BASE_URL ||
    `http://localhost:${process.env.DEPLOYMENT_MANAGER_PORT ?? 3001}`,
  docdb: {
    hostname: process.env.DOCDB_HOST ?? "120.0.0.1",
    port: process.env.DOCDB_PORT ?? "27017",
    username: process.env.DOCDB_USERNAME,
    password: process.env.DOCDB_PASSWORD,
    use_tls: fs.existsSync(path.join(__dirname, "../../../global-bundle.pem")),
    dbname: process.env.DOCDB_DBNAME ?? "nosana_deployments",
  },
  default_minutes_before_timeout: process.env.DEFAULT_MINUTES_BEFORE_TIMEOUT
    ? parseInt(process.env.DEFAULT_MINUTES_BEFORE_TIMEOUT)
    : 20,
  client_manager_url: process.env.CLIENT_MANAGER_URL || undefined,
  rapid_completion_job_count: process.env.RAPID_COMPLETION_JOB_COUNT
    ? parseInt(process.env.RAPID_COMPLETION_JOB_COUNT)
    : 3,
  rapid_completion_threshold_minutes: process.env.RAPID_COMPLETION_THRESHOLD_MINUTES
    ? parseInt(process.env.RAPID_COMPLETION_THRESHOLD_MINUTES)
    : 5,
  task_lease_ms: process.env.TASK_LEASE_MS
    ? parseInt(process.env.TASK_LEASE_MS)
    : 120_000,
  task_max_attempts: process.env.TASK_MAX_ATTEMPTS
    ? parseInt(process.env.TASK_MAX_ATTEMPTS)
    : 5,
  task_max_inflight_retries: process.env.TASK_MAX_INFLIGHT_RETRIES
    ? parseInt(process.env.TASK_MAX_INFLIGHT_RETRIES)
    : 60,
  task_confirm_poll_interval_ms: process.env.TASK_CONFIRM_POLL_INTERVAL_MS
    ? parseInt(process.env.TASK_CONFIRM_POLL_INTERVAL_MS)
    : 2_000,
  retry_cooldown_base_ms: process.env.RETRY_COOLDOWN_BASE_MS
    ? parseInt(process.env.RETRY_COOLDOWN_BASE_MS)
    : 30_000,
  retry_cooldown_max_ms: process.env.RETRY_COOLDOWN_MAX_MS
    ? parseInt(process.env.RETRY_COOLDOWN_MAX_MS)
    : 600_000,
  retry_cooldown_multiplier: process.env.RETRY_COOLDOWN_MULTIPLIER
    ? parseFloat(process.env.RETRY_COOLDOWN_MULTIPLIER)
    : 2,
  insufficient_funds_cooldown_base_ms: process.env.INSUFFICIENT_FUNDS_COOLDOWN_BASE_MS
    ? parseInt(process.env.INSUFFICIENT_FUNDS_COOLDOWN_BASE_MS)
    : 600_000,
  insufficient_funds_cooldown_max_ms: process.env.INSUFFICIENT_FUNDS_COOLDOWN_MAX_MS
    ? parseInt(process.env.INSUFFICIENT_FUNDS_COOLDOWN_MAX_MS)
    : 21_600_000,
  insufficient_funds_cooldown_multiplier: process.env.INSUFFICIENT_FUNDS_COOLDOWN_MULTIPLIER
    ? parseFloat(process.env.INSUFFICIENT_FUNDS_COOLDOWN_MULTIPLIER)
    : 2,
  rapid_completion_cooldown_base_ms: process.env.RAPID_COMPLETION_COOLDOWN_BASE_MS
    ? parseInt(process.env.RAPID_COMPLETION_COOLDOWN_BASE_MS)
    : 60_000,
  rapid_completion_cooldown_max_ms: process.env.RAPID_COMPLETION_COOLDOWN_MAX_MS
    ? parseInt(process.env.RAPID_COMPLETION_COOLDOWN_MAX_MS)
    : 3_600_000,
  rapid_completion_cooldown_multiplier: process.env.RAPID_COMPLETION_COOLDOWN_MULTIPLIER
    ? parseFloat(process.env.RAPID_COMPLETION_COOLDOWN_MULTIPLIER)
    : 2,
  rapid_completion_max_streak: process.env.RAPID_COMPLETION_MAX_STREAK
    ? parseInt(process.env.RAPID_COMPLETION_MAX_STREAK)
    : 8,
};

export const defaultConfig: { [key: string]: DeploymentsConfig } = {
  mainnet: {
    network: "mainnet",
    nos_address:
      process.env.NOS_ADDRESS ?? "nosXBVoaCTtYdLvKY6Csb4AC8JCdQKKAaWYtx2ZMoo7",
    rpc_network:
      process.env.SOLANA_NETWORK ??
      "https://rpc.ironforge.network/mainnet?apiKey=01J4RYMAWZC65B6CND9DTZZ5BK",
    ws_network: process.env.SOLANA_WS_NETWORK || undefined,
    frps_address: process.env.FRPS_ADDRESS ?? "node.k8s.prd.nos.ci",
    dashboard_backend_url:
      process.env.DASHBOARD_BACKEND_URL || "https://dashboard.k8s.prd.nos.ci",
    ...commonConfig,
  },
  devnet: {
    network: "devnet",
    nos_address:
      process.env.NOS_ADDRESS ?? "devr1BGQndEW5k5zfvG5FsLyZv1Ap73vNgAHcQ9sUVP",
    rpc_network: process.env.SOLANA_NETWORK ?? "https://api.devnet.solana.com",
    ws_network: process.env.SOLANA_WS_NETWORK || undefined,
    frps_address: process.env.FRPS_ADDRESS ?? "node.k8s.dev.nos.ci",
    dashboard_backend_url:
      process.env.DASHBOARD_BACKEND_URL || "https://dashboard.k8s.dev.nos.ci",

    ...commonConfig,
  },
  // Local Solana validator with Nosana programs pre-baked (@nosana/localnet).
  // Reuses the devnet NOS mint + programs (the image prefetches them from devnet).
  // The worker runs in a container, so rpc/ws default to host.docker.internal —
  // override with SOLANA_NETWORK / SOLANA_WS_NETWORK as needed.
  localnet: {
    network: "localnet",
    nos_address:
      process.env.NOS_ADDRESS ?? "devr1BGQndEW5k5zfvG5FsLyZv1Ap73vNgAHcQ9sUVP",
    // `||` not `??`: compose passes empty strings for unset vars, which must
    // fall back to the container-reachable host.docker.internal defaults.
    rpc_network:
      process.env.SOLANA_NETWORK || "http://host.docker.internal:8899",
    ws_network: process.env.SOLANA_WS_NETWORK || "ws://host.docker.internal:8900",
    frps_address: process.env.FRPS_ADDRESS ?? "node.k8s.dev.nos.ci",
    dashboard_backend_url: process.env.DASHBOARD_BACKEND_URL || undefined,
    ...commonConfig,
  },
};
