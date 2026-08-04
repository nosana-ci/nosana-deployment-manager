import { getConfig } from "../../config/index.js";

const LOG = "[FRPS API]";

/** A proxy FRPS currently reports as live, correlated back to its job. */
export interface LiveProxy {
  name: string;
  jobId: string;
  opId: string | undefined;
  deploymentId: string | undefined;
}

/**
 * The subset of FRPS's `ProxyStatsInfo` we rely on. `conf` is null for offline
 * proxies — FRPS only populates it inside the `pxyManager.GetByName` branch —
 * so every field under it has to be treated as optional.
 */
interface ProxyStatsInfo {
  name?: unknown;
  status?: unknown;
  conf?: { metadatas?: Record<string, unknown> | null } | null;
}

function readProxy(entry: unknown): LiveProxy | null {
  if (!entry || typeof entry !== "object") return null;

  const { name, status, conf } = entry as ProxyStatsInfo;

  // Offline rows are name-only tombstones: FRPS leaves `conf` null, and the
  // proxy name is a one-way hash, so they carry nothing we can correlate. They
  // also linger for 7 days after disconnect, so treating them as anything other
  // than "ignore" would be wrong.
  if (status !== "online") return null;

  const jobId = conf?.metadatas?.jobId;
  const opId = conf?.metadatas?.opId;
  const deploymentId = conf?.metadatas?.deploymentId;

  // Only the `-dp` (deployment load-balanced) proxy carries jobId; the plain
  // per-job proxy has just opId. Anything without a jobId is not ours to judge.
  if (typeof name !== "string" || typeof jobId !== "string" || !jobId) return null;

  return {
    name,
    jobId,
    opId: typeof opId === "string" && opId ? opId : undefined,
    deploymentId: typeof deploymentId === "string" ? deploymentId : undefined,
  };
}

/**
 * Fetches the proxies FRPS currently reports as online, keyed by job address.
 *
 * Returns `null` — never an empty array — if the list could not be retrieved or
 * understood for ANY reason. This distinction is the safety property the whole
 * feature rests on: an empty array means "FRPS says nothing is live", which stops
 * every job, whereas `null` means "we don't know", which must stop nothing.
 * Callers must branch on it explicitly.
 *
 * One entry per online proxy (a job with several exposing ops has several), so
 * gap-recovery can re-baseline per `(job, opId)`.
 */
export async function fetchLiveProxies(): Promise<LiveProxy[] | null> {
  const {
    frps_internal_address,
    frps_internal_use_tls,
    frps_api_key,
    frps_api_timeout_ms,
  } = getConfig();

  if (!frps_internal_address) return null;

  const url = `${frps_internal_use_tls ? "https" : "http"}://${frps_internal_address}/api/proxy/http`;

  let body: unknown;

  try {
    const response = await fetch(url, {
      headers: frps_api_key ? { "X-API-Key": frps_api_key } : {},
      signal: AbortSignal.timeout(frps_api_timeout_ms),
    });

    if (!response.ok) {
      console.error(`${LOG} proxy list returned ${response.status}`);
      return null;
    }

    // FRPS never sets a Content-Type on this route, so parse the text rather
    // than relying on response.json() content sniffing.
    body = JSON.parse(await response.text());
  } catch (error) {
    console.error(`${LOG} could not fetch the proxy list`, error);
    return null;
  }

  const proxies = (body as { proxies?: unknown } | null)?.proxies;

  if (!Array.isArray(proxies)) {
    console.error(`${LOG} proxy list had an unexpected shape`, body);
    return null;
  }

  const live: LiveProxy[] = [];

  for (const entry of proxies) {
    const proxy = readProxy(entry);
    if (proxy) live.push(proxy);
  }

  return live;
}
