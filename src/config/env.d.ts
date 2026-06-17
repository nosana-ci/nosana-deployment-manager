declare namespace NodeJS {
  interface ProcessEnv {
    BACKEND_URL?: string;
    TASKS_BATCH_SIZE?: string;
    NETWORK?: "mainnet" | "devnet";
    SOLANA_NETWORK?: string;
    NOS_ADDRESS?: string;
    USE_TLS?: string;
    TASK_LEASE_MS?: string;
    TASK_MAX_ATTEMPTS?: string;
    TASK_CONFIRM_POLL_INTERVAL_MS?: string;
  }
}
