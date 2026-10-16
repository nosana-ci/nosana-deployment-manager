import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fastify, { type FastifyInstance, type RouteHandler } from "fastify";
import type { WithId } from "mongodb";

import { addSchemas } from "../../../../../schema/index.schema.js";
import { GetDeploymentJobHeadersSchema } from "../../../../../schema/get/deployments/[id]/getDeploymentJobHeaders.schema.js";
import { deploymentGetJobHeadersHandler } from "./index.js";

import type { DeploymentDocument } from "../../../../../../types/index.js";
import type { JobHeadersWorkerData } from "./worker.js";

const { spawned, workerReply } = vi.hoisted(() => ({
  spawned: [] as JobHeadersWorkerData[],
  workerReply: { error: undefined as string | undefined },
}));

// Replace the real VaultWorker (which decrypts the vault key and signs with the
// kit) with an emitter that records what it was given and signs each job as
// `signed:<job>`, or fails the whole batch when asked to.
vi.mock("../../../../../../worker/Worker.js", async () => {
  const { EventEmitter } = await import("node:events");
  class FakeVaultWorker extends EventEmitter {
    constructor(_file: string, options: { workerData: JobHeadersWorkerData }) {
      super();
      spawned.push(options.workerData);
      setImmediate(() =>
        this.emit(
          "message",
          workerReply.error
            ? { event: "ERROR", error: workerReply.error }
            : {
                event: "GENERATED",
                headers: Object.fromEntries(options.workerData.jobs.map((job) => [job, `signed:${job}`])),
              },
        ),
      );
    }
  }
  return { VaultWorker: FakeVaultWorker };
});

const OWNER = "1".repeat(44);
const DEPLOYMENT = "2".repeat(44);
const VAULT = "3".repeat(44);
const JOB_A = "4".repeat(44);
const JOB_B = "5".repeat(44);
const VAULT_KEY = "encrypted-vault-key";
const AUTH_HEADERS = { "x-user-id": OWNER, authorization: "sig" };

const setDeployment: RouteHandler<{ Params: { deployment: string } }> = async (_req, res) => {
  res.locals.deployment = { id: DEPLOYMENT, vault: VAULT } as WithId<DeploymentDocument>;
};

type Db = {
  vaults: { findOne: ReturnType<typeof vi.fn> };
  jobs: { find: ReturnType<typeof vi.fn> };
};

async function buildServer(db: Db): Promise<FastifyInstance> {
  const server = fastify({ logger: false, ajv: { customOptions: { coerceTypes: false } } });
  addSchemas(server);

  server.decorateReply("locals", {
    getter() {
      if (!this._locals) this._locals = { db };
      return this._locals;
    },
    setter(value) {
      if (!this._locals) this._locals = { db };
      Object.assign(this._locals, value);
    },
  });

  server.get(
    "/deployments/:deployment/headers",
    { schema: GetDeploymentJobHeadersSchema, preHandler: [setDeployment] },
    deploymentGetJobHeadersHandler,
  );
  await server.ready();
  return server;
}

function dbWith(runningJobs: string[], vault: object | null = { vault: VAULT, owner: OWNER, vault_key: VAULT_KEY }): Db {
  return {
    vaults: { findOne: vi.fn(async () => vault) },
    jobs: { find: vi.fn(() => ({ toArray: async () => runningJobs.map((job) => ({ job })) })) },
  };
}

describe("GET /deployments/:deployment/headers", () => {
  let server: FastifyInstance | undefined;

  beforeEach(() => {
    spawned.length = 0;
    workerReply.error = undefined;
  });

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("signs one timestamped header per running job, keyed by job address", async () => {
    const db = dbWith([JOB_A, JOB_B]);
    server = await buildServer(db);

    const res = await server.inject({
      method: "GET",
      url: `/deployments/${DEPLOYMENT}/headers`,
      headers: AUTH_HEADERS,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ headers: { [JOB_A]: `signed:${JOB_A}`, [JOB_B]: `signed:${JOB_B}` } });
    expect(spawned).toEqual([{ vault: VAULT_KEY, jobs: [JOB_A, JOB_B] }]);
    expect(db.jobs.find).toHaveBeenCalledWith(
      { deployment: DEPLOYMENT, state: "RUNNING", node: { $ne: null } },
      { projection: { job: 1 } },
    );
  });

  it("answers an empty map without signing when no job is running", async () => {
    server = await buildServer(dbWith([]));

    const res = await server.inject({
      method: "GET",
      url: `/deployments/${DEPLOYMENT}/headers`,
      headers: AUTH_HEADERS,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ headers: {} });
    expect(spawned).toHaveLength(0);
  });

  it("fails when the deployment's vault is not the caller's", async () => {
    server = await buildServer(dbWith([JOB_A], null));

    const res = await server.inject({
      method: "GET",
      url: `/deployments/${DEPLOYMENT}/headers`,
      headers: AUTH_HEADERS,
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "Could not find vault." });
    expect(spawned).toHaveLength(0);
  });

  it("reports a signing failure as a server error", async () => {
    workerReply.error = "boom";
    server = await buildServer(dbWith([JOB_A]));

    const res = await server.inject({
      method: "GET",
      url: `/deployments/${DEPLOYMENT}/headers`,
      headers: AUTH_HEADERS,
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "Failed to generate job headers." });
  });
});
