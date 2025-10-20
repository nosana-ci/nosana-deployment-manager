import path from "path";
import { fileURLToPath, URL } from "url";
import { Worker as NodeWorker, SHARE_ENV, WorkerOptions } from "worker_threads";

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
