declare namespace NodeJS {
  interface ProcessEnv {
    BACKEND_URL?: string;
    TASKS_BATCH_SIZE?: string;
    NETWORK?: "mainnet" | "devnet";
    SOLANA_NETWORK?: string;
    NOS_ADDRESS?: string;
  }
}
