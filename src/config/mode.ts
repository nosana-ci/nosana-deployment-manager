export type AppMode = "all" | "api" | "worker" | "listeners" | "consumer";

const VALID_MODES: ReadonlySet<string> = new Set<AppMode>([
  "all",
  "api",
  "worker",
  "listeners",
  "consumer",
]);

export function getAppMode(): AppMode {
  const raw = process.env.APP_MODE ?? "all";

  if (!VALID_MODES.has(raw)) {
    throw new Error(`Invalid APP_MODE "${raw}". Must be one of: ${[...VALID_MODES].join(", ")}`);
  }

  return raw as AppMode;
}

export function shouldRunApi(mode: AppMode): boolean {
  return mode === "all" || mode === "api";
}

/**
 * The change-stream listeners + Solana RPC monitor. These are producers that
 * MUST run as a singleton — duplicating them double-schedules work — so they
 * deploy at `replicas: 1` (or, later, leader-elected), separate from the
 * consumer.
 */
export function shouldRunListeners(mode: AppMode): boolean {
  return mode === "all" || mode === "worker" || mode === "listeners";
}

/**
 * The task-queue consumer: claim → lock → dispatch. Built as N competing
 * consumers (lease-fenced claims), so it scales horizontally to demand.
 */
export function shouldRunConsumer(mode: AppMode): boolean {
  return mode === "all" || mode === "worker" || mode === "consumer";
}

/**
 * True when the process runs any worker subsystem (listeners and/or consumer).
 * Gates the shared worker setup: kit init, worker metrics, and the health
 * server. DB migrations are gated on {@link shouldRunListeners}, not this, so
 * scaled-out consumers never race the migrator.
 */
export function shouldRunWorker(mode: AppMode): boolean {
  return shouldRunListeners(mode) || shouldRunConsumer(mode);
}
