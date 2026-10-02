import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

/**
 * Stand-in for host-manager's `POST /reservations`, so the scenario suite never
 * talks to a real host-manager. Started once per run by vitest (`globalSetup`);
 * the DM in Docker reaches it via host.docker.internal, the tests script it
 * over `/__mock/*` with the `hostManagerMock` control client exported below.
 *
 * Model: a market queue the tests keep in sync with the chain (`joinMarketQueue`
 * enqueues the node), a FIFO plan of scripted responses that take precedence
 * over the queue, and a per-idempotency-key memo so a replayed key returns the
 * same 200 — exactly what host-manager does. A node handed out leaves the mock
 * queue, as an assigned node leaves the on-chain one.
 */

// ---------------------------------------------------------------------------
// Test-side control (runs in the test forks; talks to the server over HTTP)
// ---------------------------------------------------------------------------

export type ReservationPlanEntry = {
  /** Nodes to hand out for this request (any addresses, queued or not); omitted → the mock queue. */
  nodes?: string[];
  /** How long the hold lasts (`expiresAt`); omitted → 60 s. */
  expiresInMs?: number;
  /** A non-200 answer instead, with `message`. */
  status?: number;
  message?: string;
};

export type ReservationCall = {
  at: string;
  idempotencyKey: string;
  market: string;
  count: number;
  requirements?: Record<string, unknown>;
  authorization: string | null;
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
  /** Forget queue, plan, memoised keys and recorded calls. */
  reset: () => control<{ ok: true }>("DELETE", "/__mock"),
  /** Mirror a node joining the on-chain market queue. */
  enqueue: (node: string) => control<{ queue: string[] }>("POST", "/__mock/queue", { nodes: [node] }),
  /** Script the next reservation responses, consumed in order before the queue is used. */
  plan: (responses: ReservationPlanEntry[]) => control<{ plan: ReservationPlanEntry[] }>("POST", "/__mock/plan", { responses }),
  /** Every `POST /reservations` the DM made since the last reset. */
  calls: () => control<{ calls: ReservationCall[] }>("GET", "/__mock/calls").then(({ calls }) => calls),
};

/** `taskId:reserve:epoch` → `reserve:epoch`, so flows can assert the key walk without knowing the task id. */
export const reservationEpochs = (calls: ReservationCall[]) => calls.map((call) => call.idempotencyKey.replace(/^[^:]+:/, ""));

// ---------------------------------------------------------------------------
// The server (started once per run by vitest's globalSetup, see the default export)
// ---------------------------------------------------------------------------

type ReserveBody = { market: string; count?: number; idempotencyKey: string; requirements?: Record<string, unknown> };
type Reply = { status: number; body: unknown };

const state = {
  queue: [] as string[],
  plan: [] as ReservationPlanEntry[],
  byKey: new Map<string, Reply>(),
  calls: [] as ReservationCall[],
  expiresInMs: 60_000,
};

function reset() {
  state.queue = [];
  state.plan = [];
  state.byKey = new Map();
  state.calls = [];
}

function reserve(body: ReserveBody): Reply {
  const replay = state.byKey.get(body.idempotencyKey);
  if (replay) return replay;

  const entry = state.plan.shift();
  if (entry?.status && entry.status !== 200) {
    return { status: entry.status, body: { message: entry.message ?? `mocked ${entry.status}` } };
  }
  const count = body.count ?? 1;
  const nodes = entry?.nodes ? entry.nodes.slice(0, count) : state.queue.splice(0, count);
  const expiresInMs = entry?.expiresInMs ?? state.expiresInMs;
  const reply: Reply = {
    status: 200,
    body: {
      requested: count,
      reserved: nodes.length,
      expiresAt: nodes.length ? new Date(Date.now() + expiresInMs).toISOString() : null,
      nodes: nodes.map((nodeAddress) => ({ nodeAddress, market: body.market })),
    },
  };
  state.byKey.set(body.idempotencyKey, reply);
  return reply;
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
  const route = `${req.method} ${(req.url ?? "/").split("?")[0]}`;
  switch (route) {
    case "POST /reservations": {
      if (req.headers.authorization !== key) return send(res, 401, { message: "Unauthorized" });
      const body = await readJson<ReserveBody>(req);
      state.calls.push({
        at: new Date().toISOString(),
        idempotencyKey: body.idempotencyKey,
        market: body.market,
        count: body.count ?? 1,
        requirements: body.requirements,
        authorization: req.headers.authorization ?? null,
      });
      const reply = reserve(body);
      return send(res, reply.status, reply.body);
    }
    case "POST /__mock/queue": {
      const { nodes = [] } = await readJson<{ nodes?: string[] }>(req);
      for (const node of nodes) if (!state.queue.includes(node)) state.queue.push(node);
      return send(res, 200, { queue: state.queue });
    }
    case "POST /__mock/plan": {
      const { responses = [] } = await readJson<{ responses?: ReservationPlanEntry[] }>(req);
      state.plan.push(...responses);
      return send(res, 200, { plan: state.plan });
    }
    case "GET /__mock/calls":
      return send(res, 200, { calls: state.calls });
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
  console.log(`[host-manager-mock] listening on ${port} (POST /reservations, control under /__mock)`);
  return () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
