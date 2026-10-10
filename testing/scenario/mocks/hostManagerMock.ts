import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { isDeepStrictEqual } from "node:util";

/**
 * Stand-in for host-manager's reservation requests (`POST /reservations/requests`,
 * `DELETE /reservations/requests/:key`) and its authenticated webhook, so the scenario
 * suite never talks to a real host-manager. Started once per run by vitest
 * (`globalSetup`); the DM in Docker reaches it via host.docker.internal, the
 * tests script it over `/__mock/*` with the `hostManagerMock` control client
 * exported below.
 *
 * Model: a market queue the tests keep in sync with the chain (`joinMarketQueue`
 * enqueues the node), a FIFO plan of scripted responses that take precedence
 * over the queue for new requests, and the requests themselves keyed like
 * host-manager's: a new key is filled from the queue at once or left waiting,
 * the same key renews (and may fill) a waiting request and replays a filled
 * one. When a node joins, the oldest waiting request takes it and the DM gets a
 * authenticated webhook, as host-manager's poller would do. A node handed out leaves
 * the mock queue, as an assigned node leaves the on-chain one.
 */

// ---------------------------------------------------------------------------
// Test-side control (runs in the test forks; talks to the server over HTTP)
// ---------------------------------------------------------------------------

export type ReservationPlanEntry = {
  /** Nodes to hand out for this request (any addresses, queued or not); omitted → the mock queue. */
  nodes?: string[];
  /** How long the hold lasts (`holdExpiresAt`); omitted → 60 s. */
  expiresInMs?: number;
  /** Leave the request waiting even if the queue has nodes. */
  wait?: boolean;
  /** A non-200 answer instead, with `message`. */
  status?: number;
  message?: string;
};

export type ReservationCall = {
  at: string;
  /** The request key: the id of the LIST task that asked. */
  key: string;
  market: string;
  count: number;
  requirements?: Record<string, unknown>;
};

export type WebhookDelivery = { at: string; key: string; status: number | null };

export type FulfilOptions = {
  /** Nodes to fill the oldest waiting request with; omitted → the mock queue. */
  nodes?: string[];
  /** Hold length; negative for a hold that has already lapsed. Omitted → 60 s. */
  holdMs?: number;
  /** Send the webhook (default true); false fills silently, as if the webhook got lost. */
  deliver?: boolean;
};

const base = () => process.env.HOST_MANAGER_MOCK_URL ?? "http://localhost:3006";

async function control<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${base()}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`host-manager mock ${method} ${path} returned ${response.status}`);
  return response.json() as Promise<T>;
}

export const hostManagerMock = {
  /** Forget queue, plan, requests and recorded calls; webhooks back on. */
  reset: () => control<{ ok: true }>("DELETE", "/__mock"),
  /** Mirror a node joining the on-chain market queue; a waiting request takes it (webhook). */
  enqueue: (node: string) => control<{ queue: string[] }>("POST", "/__mock/queue", { nodes: [node] }),
  /** Script the next new requests' responses, consumed in order before the queue is used. */
  plan: (responses: ReservationPlanEntry[]) => control<{ plan: ReservationPlanEntry[] }>("POST", "/__mock/plan", { responses }),
  /** Fill the oldest waiting request now (see {@link FulfilOptions}). */
  fulfil: (options: FulfilOptions = {}) => control<{ key: string | null }>("POST", "/__mock/fulfil", options),
  /** Turn webhooks off (fills stay silent, the DM must renew to find out) or back on. */
  webhooks: (enabled: boolean) => control<{ enabled: boolean }>("POST", "/__mock/webhooks", { enabled }),
  /** Every `POST /reservations/requests` the DM made since the last reset (renewals included). */
  calls: () => control<{ calls: ReservationCall[] }>("GET", "/__mock/calls").then(({ calls }) => calls),
  /** Every key the DM cancelled since the last reset. */
  cancels: () => control<{ cancels: string[] }>("GET", "/__mock/cancels").then(({ cancels }) => cancels),
  /** Every webhook sent since the last reset, with the DM's answer (null: no response). */
  deliveries: () => control<{ deliveries: WebhookDelivery[] }>("GET", "/__mock/deliveries").then(({ deliveries }) => deliveries),
};

/**
 * Each call's key as `task:<n>`, numbered by first appearance, so flows can tell
 * a renewal (the same task again) from a hand-off (a new task) without task ids.
 */
export const requestingTasks = (calls: ReservationCall[]) => {
  const keys = [...new Set(calls.map((call) => call.key))];
  return calls.map((call) => `task:${keys.indexOf(call.key) + 1}`);
};

// ---------------------------------------------------------------------------
// The server (started once per run by vitest's globalSetup, see the default export)
// ---------------------------------------------------------------------------

type RequestBody = { key: string; market: string; count?: number; requirements?: Record<string, unknown> };
type Reply = { status: number; body: unknown };
type HeldRequest = {
  key: string;
  market: string;
  requirements?: Record<string, unknown>;
  count: number;
  status: "waiting" | "fulfilled" | "cancelled";
  nodes: string[];
  holdExpiresAt: string | null;
};

const REQUEST_TTL_MS = 15 * 60_000;
/** Hold length when a test does not script one. */
const HOLD_MS = 60_000;

const state = {
  queue: [] as string[],
  plan: [] as ReservationPlanEntry[],
  requests: new Map<string, HeldRequest>(),
  calls: [] as ReservationCall[],
  cancels: [] as string[],
  deliveries: [] as WebhookDelivery[],
  webhooks: true,
};

function reset() {
  state.queue = [];
  state.plan = [];
  state.requests = new Map();
  state.calls = [];
  state.cancels = [];
  state.deliveries = [];
  state.webhooks = true;
}

function view(request: HeldRequest): Reply {
  return {
    status: 200,
    body: {
      key: request.key,
      status: request.status,
      requested: request.count,
      nodes: request.status === "fulfilled" ? request.nodes.map((nodeAddress) => ({ nodeAddress, market: request.market })) : [],
      holdExpiresAt: request.status === "fulfilled" ? request.holdExpiresAt : null,
      expiresAt: new Date(Date.now() + REQUEST_TTL_MS).toISOString(),
    },
  };
}

function fill(request: HeldRequest, nodes: string[], holdMs = HOLD_MS) {
  request.status = "fulfilled";
  request.nodes = nodes.slice(0, request.count);
  request.holdExpiresAt = new Date(Date.now() + holdMs).toISOString();
}

/**
 * Create or renew a request; a waiting one is filled from the queue when it can
 * be (no webhook). A key reused with other terms is a 409, as host-manager answers.
 */
function requestNodes(body: RequestBody): Reply {
  const existing = state.requests.get(body.key);
  if (existing && !isSameTerms(existing, body)) {
    return { status: 409, body: { message: `Request ${body.key} was made with other terms` } };
  }
  if (existing) {
    if (existing.status === "waiting" && state.queue.length > 0) fill(existing, state.queue.splice(0, existing.count));
    return view(existing);
  }

  const entry = state.plan.shift();
  if (entry?.status && entry.status !== 200) {
    return { status: entry.status, body: { message: entry.message ?? `mocked ${entry.status}` } };
  }
  const request: HeldRequest = {
    key: body.key,
    market: body.market,
    requirements: body.requirements,
    count: body.count ?? 1,
    status: "waiting",
    nodes: [],
    holdExpiresAt: null,
  };
  state.requests.set(body.key, request);
  if (entry?.nodes) fill(request, entry.nodes, entry.expiresInMs);
  else if (!entry?.wait && state.queue.length > 0) fill(request, state.queue.splice(0, request.count), entry?.expiresInMs);
  return view(request);
}

function isSameTerms(request: HeldRequest, body: RequestBody) {
  return (
    request.market === body.market &&
    request.count === (body.count ?? 1) &&
    isDeepStrictEqual(request.requirements ?? {}, body.requirements ?? {})
  );
}

function cancel(key: string): Reply {
  state.cancels.push(key);
  const request = state.requests.get(key);
  if (!request) return { status: 200, body: { key, status: "cancelled", released: 0 } };
  if (request.status === "waiting") request.status = "cancelled";
  return { status: 200, body: { key, status: request.status, released: request.status === "fulfilled" ? request.nodes.length : 0 } };
}

/** Fill the oldest waiting request (explicit nodes, or from the queue) and webhook the DM unless told not to. */
function fulfilOldest({ nodes, holdMs, deliver = true }: FulfilOptions, secret: string): string | null {
  const request = [...state.requests.values()].find((candidate) => candidate.status === "waiting");
  if (!request) return null;
  const filled = nodes ?? state.queue.splice(0, request.count);
  if (filled.length === 0) return null;
  fill(request, filled, holdMs);
  if (deliver && state.webhooks) void deliverWebhook(request, secret);
  return request.key;
}

/**
 * POST the fulfilment to the DM (authorization: the shared key) once, as
 * host-manager does: no retry. A missed fill stays fulfilled, its hold lapses,
 * and the DM finds out by renewing.
 */
async function deliverWebhook(request: HeldRequest, secret: string) {
  const url = process.env.DEPLOYMENT_MANAGER_WEBHOOK_URL ?? "http://localhost:3001/webhooks/reservations";
  const raw = JSON.stringify({
    deliveryId: randomUUID(),
    key: request.key,
    status: "fulfilled",
    requested: request.count,
    nodes: request.nodes.map((nodeAddress) => ({ nodeAddress, market: request.market })),
    holdExpiresAt: request.holdExpiresAt,
  });
  const status = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: secret },
    body: raw,
  }).then((response) => response.status, () => null);
  state.deliveries.push({ at: new Date().toISOString(), key: request.key, status });
}

function readJson<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => (data += chunk));
    req.on("end", () => {
      try {
        resolve((data ? JSON.parse(data) : {}) as T);
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function handle(req: IncomingMessage, res: ServerResponse, key: string) {
  const path = (req.url ?? "/").split("?")[0];
  const cancelled = req.method === "DELETE" && /^\/reservations\/requests\/[^/]+$/.test(path);
  const route = cancelled ? "DELETE /reservations/requests/:key" : `${req.method} ${path}`;
  switch (route) {
    case "POST /reservations/requests": {
      if (req.headers.authorization !== key) return send(res, 401, { message: "Unauthorized" });
      const body = await readJson<RequestBody>(req);
      state.calls.push({
        at: new Date().toISOString(),
        key: body.key,
        market: body.market,
        count: body.count ?? 1,
        requirements: body.requirements,
      });
      const reply = requestNodes(body);
      return send(res, reply.status, reply.body);
    }
    case "DELETE /reservations/requests/:key": {
      if (req.headers.authorization !== key) return send(res, 401, { message: "Unauthorized" });
      const reply = cancel(decodeURIComponent(path.slice("/reservations/requests/".length)));
      return send(res, reply.status, reply.body);
    }
    case "POST /__mock/queue": {
      const { nodes = [] } = await readJson<{ nodes?: string[] }>(req);
      for (const node of nodes) if (!state.queue.includes(node)) state.queue.push(node);
      // host-manager's poller: waiting requests take the new nodes, oldest first.
      while (state.queue.length > 0 && fulfilOldest({}, key) !== null) continue;
      return send(res, 200, { queue: state.queue });
    }
    case "POST /__mock/plan": {
      const { responses = [] } = await readJson<{ responses?: ReservationPlanEntry[] }>(req);
      state.plan.push(...responses);
      return send(res, 200, { plan: state.plan });
    }
    case "POST /__mock/fulfil":
      return send(res, 200, { key: fulfilOldest(await readJson<FulfilOptions>(req), key) });
    case "POST /__mock/webhooks": {
      const { enabled = true } = await readJson<{ enabled?: boolean }>(req);
      state.webhooks = enabled;
      return send(res, 200, { enabled });
    }
    case "GET /__mock/calls":
      return send(res, 200, { calls: state.calls });
    case "GET /__mock/cancels":
      return send(res, 200, { cancels: state.cancels });
    case "GET /__mock/deliveries":
      return send(res, 200, { deliveries: state.deliveries });
    case "DELETE /__mock":
      reset();
      return send(res, 200, { ok: true });
    case "GET /health":
      return send(res, 200, { status: "healthy" });
    default:
      return send(res, 404, { message: `No mock route for ${route}` });
  }
}

export function startHostManagerMock(port: number, key: string): Promise<Server> {
  const server = createServer((req, res) => {
    handle(req, res, key).catch((error: unknown) =>
      send(res, 500, { message: error instanceof Error ? error.message : String(error) })
    );
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

/** vitest `globalSetup`: one mock for the whole run, torn down at the end. */
export default async function setup() {
  const port = Number(process.env.HOST_MANAGER_MOCK_PORT ?? 3006);
  const key = process.env.HOST_MANAGER_MOCK_KEY ?? "scenario-host-manager-key";
  const server = await startHostManagerMock(port, key);
  console.log(`[host-manager-mock] listening on ${port} (/reservations/requests, control under /__mock)`);
  return () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
