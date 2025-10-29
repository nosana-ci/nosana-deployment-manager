import path from "path";
import { Client } from "@nosana/sdk";
import { fileURLToPath, URL } from "url";
import { Worker as NodeWorker, SHARE_ENV, WorkerOptions } from "worker_threads";

import { getConfig } from "../../config/index.js";
import { decryptWithKey } from "../../vault/decrypt.js";
import { covertStringToIterable } from "../utils/convertStringToIterable.js";

import type { WorkerData } from "../../types/index.js";

export class Worker extends NodeWorker {
  constructor(fileName: string | URL, options: WorkerOptions) {
    if (typeof fileName === "string") {
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      fileName = path.resolve(__dirname, fileName);
    }

    super(
      fileName,
      {
        ...options,
        env: SHARE_ENV,
      },
    );
  }
}

export function workerErrorFormatter(error: unknown): string {
  return error instanceof Error
    ? `${error.name} ${error.message}`
    : typeof error === "object"
      ? JSON.stringify(error)
      : String(error);
}

export async function prepareWorker(workerData: WorkerData): Promise<
  WorkerData & { client: Client, useNosanaApiKey: boolean }
> {
  try {
    const { register } = await import("ts-node");
    register();
  } catch {
    /* empty */
  }

  const config = getConfig();
  const key = decryptWithKey(workerData.vault);
  const useNosanaApiKey = key.startsWith("nos_");
  const client = new Client(...[
    config.network,
    useNosanaApiKey ? undefined : covertStringToIterable(key),
    useNosanaApiKey ? { apiKey: key } : { solana: { network: config.rpc_network } },
  ]);

  return {
    client,
    useNosanaApiKey,
    ...workerData,
  };
}