import path from "path";
import { fileURLToPath, URL } from "url";
import { createKeyPairSignerFromBytes } from "@solana/signers";
import { Worker as NodeWorker, SHARE_ENV, WorkerOptions } from "worker_threads";
import { createNosanaClient, NosanaClient, PartialClientConfig } from "@nosana/kit";
import { getConfig } from "../config/index.js";
import { decryptWithKey } from "../vault/index.js";
import { convertStringToUint8Array } from "../tasks/utils/convertStringToUint8Array.js";

export type VaultWorkerData<T = {}> = { vault: string } & T;

type VaultWorkerOptions<T extends VaultWorkerData> = WorkerOptions & { workerData: T };

export class VaultWorker<T extends VaultWorkerData = VaultWorkerData> extends NodeWorker {
  constructor(fileName: string | URL, options: VaultWorkerOptions<T>) {
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

export async function prepareWorker<T extends VaultWorkerData = VaultWorkerData>(workerData: T): Promise<
  T & { kit: NosanaClient, useNosanaApiKey: boolean }
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

  const clientConfig: Partial<PartialClientConfig> = useNosanaApiKey ? { api: { apiKey: key } } : { solana: { rpcEndpoint: config.rpc_network } }
  if (config.dashboard_backend_url) {
    clientConfig.api = { backend_url: config.dashboard_backend_url };
  }
  const kit = createNosanaClient(
    config.network,
    {
      ...clientConfig,
      wallet: useNosanaApiKey ? undefined : await createKeyPairSignerFromBytes(convertStringToUint8Array(key)),
    }
  );

  return {
    kit,
    useNosanaApiKey,
    ...workerData,
  };
}