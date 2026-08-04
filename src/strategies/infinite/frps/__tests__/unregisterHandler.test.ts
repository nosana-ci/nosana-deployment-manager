import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Db } from "mongodb";

vi.mock("../../../../tasks/scheduleTask.js", () => ({
  scheduleTask: vi.fn(),
}));

vi.mock("../../../../repositories/index.js", () => ({
  DeploymentsRepository: { findOne: vi.fn() },
  JobsRepository: { findOne: vi.fn() },
  EventsRepository: { create: vi.fn() },
  FrpsEndpointStatusRepository: { collection: { updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }) } },
}));

vi.mock("../../../../client/frps/index.js", () => ({
  fetchLiveProxies: vi.fn(),
}));

import { frpsUnregisterHandler } from "../unregisterHandler.js";
import { fetchLiveProxies, type LiveProxy } from "../../../../client/frps/index.js";
import { scheduleTask } from "../../../../tasks/scheduleTask.js";
import {
  DeploymentsRepository,
  EventsRepository,
  JobsRepository,
  FrpsEndpointStatusRepository,
} from "../../../../repositories/index.js";
import { setConfig } from "../../../../config/index.js";

import {
  DeploymentStatus,
  DeploymentStrategy,
  EventType,
  JobState,
  TaskType,
} from "../../../../types/index.js";
import {
  FRPSCloseReasons,
  FRPSEventTypes,
  type UnregisteredEvent,
} from "../../../../listeners/frps/types.js";

const NOW = new Date("2026-07-21T12:00:00Z");
const GRACE_MS = 60_000;
const DEPLOYMENT_ID = "deployment-1";
const JOB_ID = "job-1";

const mockedScheduleTask = vi.mocked(scheduleTask);
const mockedFetchLiveProxies = vi.mocked(fetchLiveProxies);
const mockedDeploymentFindOne = vi.mocked(DeploymentsRepository.findOne);
const mockedJobFindOne = vi.mocked(JobsRepository.findOne);
const mockedEventsCreate = vi.mocked(EventsRepository.create);

const db = {} as Db;

const deployment = {
  id: DEPLOYMENT_ID,
  status: DeploymentStatus.RUNNING,
  strategy: DeploymentStrategy.INFINITE,
};

function createEvent(
  metadatas?: UnregisteredEvent["metadatas"],
  reason: UnregisteredEvent["reason"] = FRPSCloseReasons.LOST
): UnregisteredEvent {
  return {
    type: FRPSEventTypes.UNREGISTERED,
    proxyName: "proxy-1",
    proxyType: "http",
    timestamp: NOW.getTime(),
    metadatas,
    reason,
  };
}

const validEvent = createEvent([{ deploymentId: DEPLOYMENT_ID, opId: "op-1", jobId: JOB_ID }]);

describe("frpsUnregisterHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    setConfig("frps_unhealthy_grace_ms", GRACE_MS);

    // Default happy-path wiring; individual tests narrow it.
    mockedDeploymentFindOne.mockResolvedValue(deployment as never);
    mockedJobFindOne.mockResolvedValue({ job: JOB_ID, state: JobState.RUNNING } as never);
    mockedScheduleTask.mockResolvedValue(true);
    vi.mocked(FrpsEndpointStatusRepository.collection.updateOne).mockResolvedValue({ matchedCount: 1 } as never);
    // Default: FRPS confirms the proxy really is gone.
    mockedFetchLiveProxies.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("no-ops", () => {
    it("skips an event with no metadata at all", async () => {
      await frpsUnregisterHandler(createEvent(), db);

      expect(mockedDeploymentFindOne).not.toHaveBeenCalled();
      expect(mockedScheduleTask).not.toHaveBeenCalled();
    });

    it("skips when the metadata carries no jobId", async () => {
      await frpsUnregisterHandler(createEvent([{ deploymentId: DEPLOYMENT_ID }]), db);

      expect(mockedDeploymentFindOne).not.toHaveBeenCalled();
      expect(mockedScheduleTask).not.toHaveBeenCalled();
    });

    it("skips when the metadata carries no deploymentId", async () => {
      await frpsUnregisterHandler(createEvent([{ jobId: JOB_ID }]), db);

      expect(mockedDeploymentFindOne).not.toHaveBeenCalled();
      expect(mockedScheduleTask).not.toHaveBeenCalled();
    });

    it("skips when the deployment does not exist", async () => {
      mockedDeploymentFindOne.mockResolvedValue(null);

      await frpsUnregisterHandler(validEvent, db);

      expect(mockedJobFindOne).not.toHaveBeenCalled();
      expect(mockedScheduleTask).not.toHaveBeenCalled();
    });

    it("skips a non-infinite deployment", async () => {
      mockedDeploymentFindOne.mockResolvedValue({
        ...deployment,
        strategy: DeploymentStrategy.SIMPLE,
      } as never);

      await frpsUnregisterHandler(validEvent, db);

      expect(mockedScheduleTask).not.toHaveBeenCalled();
    });

    it("skips an infinite deployment that is not RUNNING", async () => {
      mockedDeploymentFindOne.mockResolvedValue({
        ...deployment,
        status: DeploymentStatus.STOPPING,
      } as never);

      await frpsUnregisterHandler(validEvent, db);

      expect(mockedScheduleTask).not.toHaveBeenCalled();
    });

    it("skips when the job is not found", async () => {
      mockedJobFindOne.mockResolvedValue(null);

      await frpsUnregisterHandler(validEvent, db);

      expect(mockedScheduleTask).not.toHaveBeenCalled();
    });

    it.each([JobState.COMPLETED, JobState.STOPPED])(
      "skips a job that has already settled as %s",
      async (state) => {
        mockedJobFindOne.mockResolvedValue({ job: JOB_ID, state } as never);

        await frpsUnregisterHandler(validEvent, db);

        expect(mockedScheduleTask).not.toHaveBeenCalled();
      }
    );

    it("does not emit an event when an idempotent schedule no-ops", async () => {
      mockedScheduleTask.mockResolvedValue(false);

      await frpsUnregisterHandler(validEvent, db);

      expect(mockedEventsCreate).not.toHaveBeenCalled();
    });
  });

  describe("close reason", () => {
    // A job's ops each run their own frpc container, so a proxy going away
    // mid-job is normal when one op finishes and the next starts. Only a lost
    // control connection means something actually broke.

    it("ignores a graceful teardown, which is just an op finishing", async () => {
      const graceful = createEvent(
        [{ deploymentId: DEPLOYMENT_ID, jobId: JOB_ID }],
        FRPSCloseReasons.GRACEFUL
      );

      await frpsUnregisterHandler(graceful, db);

      expect(mockedDeploymentFindOne).not.toHaveBeenCalled();
      expect(mockedScheduleTask).not.toHaveBeenCalled();
    });

    it("ignores an event with no reason, from an FRPS predating the distinction", async () => {
      // Built without the key at all rather than `reason: undefined`, which a
      // default parameter would quietly fill back in.
      const unversioned: UnregisteredEvent = {
        type: FRPSEventTypes.UNREGISTERED,
        proxyName: "proxy-1",
        proxyType: "http",
        timestamp: NOW.getTime(),
        metadatas: [{ deploymentId: DEPLOYMENT_ID, jobId: JOB_ID }],
      };

      await frpsUnregisterHandler(unversioned, db);

      expect(mockedScheduleTask).not.toHaveBeenCalled();
    });

    it("acts on a lost control connection", async () => {
      await frpsUnregisterHandler(validEvent, db);

      expect(mockedScheduleTask).toHaveBeenCalledOnce();
    });
  });

  describe("verification against the live proxy list", () => {
    // Even a lost teardown is confirmed, since frpc may have reconnected between
    // the event being published and us handling it.

    const liveProxy = (jobId: string): LiveProxy => ({
      name: "proxy-1",
      jobId,
      opId: "op-1",
      deploymentId: DEPLOYMENT_ID,
    });

    it("ignores the event when the proxy is still online", async () => {
      mockedFetchLiveProxies.mockResolvedValue([liveProxy(JOB_ID)]);

      await frpsUnregisterHandler(validEvent, db);

      expect(mockedScheduleTask).not.toHaveBeenCalled();
      expect(mockedEventsCreate).not.toHaveBeenCalled();
    });

    it("still stops when the proxy list cannot be read — grace + cancel covers a reconnect", async () => {
      // The tunnel is genuinely lost; a transient API failure must not drop the
      // signal. The grace window and registerHandler's cancel handle a reconnect.
      mockedFetchLiveProxies.mockResolvedValue(null);

      await frpsUnregisterHandler(validEvent, db);

      expect(mockedScheduleTask).toHaveBeenCalledOnce();
    });

    it("stops the job when the proxy list confirms it is gone", async () => {
      mockedFetchLiveProxies.mockResolvedValue([liveProxy("another-job")]);

      await frpsUnregisterHandler(validEvent, db);

      expect(mockedScheduleTask).toHaveBeenCalledOnce();
    });

    it("does not call out to FRPS for an event it would skip anyway", async () => {
      mockedDeploymentFindOne.mockResolvedValue(null);

      await frpsUnregisterHandler(validEvent, db);

      expect(mockedFetchLiveProxies).not.toHaveBeenCalled();
    });
  });

  describe("scheduling", () => {
    it.each([JobState.RUNNING, JobState.QUEUED])(
      "schedules a grace-delayed idempotent STOP for a %s job",
      async (state) => {
        mockedJobFindOne.mockResolvedValue({ job: JOB_ID, state } as never);

        await frpsUnregisterHandler(validEvent, db);

        expect(mockedScheduleTask).toHaveBeenCalledExactlyOnceWith(
          db,
          TaskType.STOP,
          DEPLOYMENT_ID,
          DeploymentStatus.RUNNING,
          new Date(NOW.getTime() + GRACE_MS),
          { job: JOB_ID, idempotent: true }
        );
      }
    );

    it("looks the job up scoped to its deployment", async () => {
      await frpsUnregisterHandler(validEvent, db);

      expect(mockedJobFindOne).toHaveBeenCalledWith({
        job: JOB_ID,
        deployment: DEPLOYMENT_ID,
      });
    });

    it("records why the job was stopped", async () => {
      await frpsUnregisterHandler(validEvent, db);

      expect(mockedEventsCreate).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          category: EventType.DEPLOYMENT,
          deploymentId: DEPLOYMENT_ID,
          type: "FRPS_TUNNEL_LOST",
        })
      );
    });

    it("honours a reconfigured grace period", async () => {
      setConfig("frps_unhealthy_grace_ms", 5_000);

      await frpsUnregisterHandler(validEvent, db);

      expect(mockedScheduleTask).toHaveBeenCalledWith(
        db,
        TaskType.STOP,
        DEPLOYMENT_ID,
        DeploymentStatus.RUNNING,
        new Date(NOW.getTime() + 5_000),
        expect.anything()
      );
    });

    it("resolves the job from metadata split across several objects", async () => {
      await frpsUnregisterHandler(
        createEvent([{ deploymentId: DEPLOYMENT_ID }, { jobId: JOB_ID }]),
        db
      );

      expect(mockedScheduleTask).toHaveBeenCalledOnce();
    });
  });
});
