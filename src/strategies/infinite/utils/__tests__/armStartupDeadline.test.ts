import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Db } from "mongodb";

vi.mock("../../../../tasks/scheduleTask.js", () => ({
  scheduleTask: vi.fn(),
}));

vi.mock("../../../../repositories/index.js", () => ({
  TasksRepository: { collection: { deleteOne: vi.fn() } },
  JobsRepository: { collection: { updateOne: vi.fn(), findOneAndUpdate: vi.fn() } },
  FrpsEndpointStatusRepository: { findOne: vi.fn() },
}));

import { armStartupDeadline } from "../armStartupDeadline.js";
import { scheduleTask } from "../../../../tasks/scheduleTask.js";
import {
  FrpsEndpointStatusRepository,
  JobsRepository,
  TasksRepository,
} from "../../../../repositories/index.js";

import {
  type DeploymentDocument,
  DeploymentStatus,
  DeploymentStrategy,
  TaskType,
} from "../../../../types/index.js";

const NOW = new Date("2026-07-21T12:00:00Z");
const DEPLOYMENT_ID = "deployment-1";
const JOB_ID = "job-1";
/** 5 minutes past NOW. */
const DEADLINE = new Date("2026-07-21T12:05:00Z");

const mockedScheduleTask = vi.mocked(scheduleTask);
const mockedDeleteOne = vi.mocked(TasksRepository.collection.deleteOne);
const mockedJobUpdate = vi.mocked(JobsRepository.collection.updateOne);
const mockedStatusFindOne = vi.mocked(FrpsEndpointStatusRepository.findOne);

const db = {} as Db;

function deployment(overrides: Partial<DeploymentDocument> = {}): DeploymentDocument {
  return {
    id: DEPLOYMENT_ID,
    status: DeploymentStatus.RUNNING,
    strategy: DeploymentStrategy.INFINITE,
    rotation_time: 20,
    startup_timeout: 5,
    endpoints: [{ opId: "op-1", port: 8080, url: "https://example.test" }],
    ...overrides,
  } as DeploymentDocument;
}

describe("armStartupDeadline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mockedScheduleTask.mockResolvedValue(true);
    mockedStatusFindOne.mockResolvedValue(null);
    mockedDeleteOne.mockResolvedValue({ deletedCount: 1, acknowledged: true } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("schedules a STOP targeting the job, due one startup_timeout out", async () => {
    await armStartupDeadline(db, deployment(), JOB_ID);

    expect(mockedScheduleTask).toHaveBeenCalledExactlyOnceWith(
      db,
      TaskType.STOP,
      DEPLOYMENT_ID,
      DeploymentStatus.RUNNING,
      DEADLINE,
      { job: JOB_ID, idempotent: true },
    );
  });

  it("marks the job with its deadline so a rotation can be attributed to it", async () => {
    await armStartupDeadline(db, deployment(), JOB_ID);

    expect(mockedJobUpdate).toHaveBeenCalledExactlyOnceWith(
      { job: JOB_ID, deployment: DEPLOYMENT_ID },
      { $set: { startup_deadline: DEADLINE } },
    );
  });

  it("does nothing without a configured startup_timeout", async () => {
    await armStartupDeadline(db, deployment({ startup_timeout: undefined }), JOB_ID);

    expect(mockedScheduleTask).not.toHaveBeenCalled();
    expect(mockedJobUpdate).not.toHaveBeenCalled();
  });

  it("does nothing when the deployment exposes no ports: nothing could ever report it online", async () => {
    await armStartupDeadline(db, deployment({ endpoints: [] }), JOB_ID);

    expect(mockedScheduleTask).not.toHaveBeenCalled();
  });

  it("leaves an already-pending stop for this job alone", async () => {
    mockedScheduleTask.mockResolvedValue(false);

    await armStartupDeadline(db, deployment(), JOB_ID);

    expect(mockedJobUpdate).not.toHaveBeenCalled();
    expect(mockedStatusFindOne).not.toHaveBeenCalled();
  });

  describe("when the tunnel registered before the job reached RUNNING", () => {
    beforeEach(() => {
      mockedStatusFindOne.mockResolvedValue({ job: JOB_ID, state: "up" } as never);
    });

    it("disarms itself, so an already-online job is never stopped", async () => {
      await armStartupDeadline(db, deployment(), JOB_ID);

      expect(mockedDeleteOne).toHaveBeenCalledExactlyOnceWith({
        task: TaskType.STOP,
        deploymentId: DEPLOYMENT_ID,
        job: JOB_ID,
        status: "PENDING",
        due_at: { $gt: NOW },
      });
    });

    it("checks the tunnel only after the stop exists, so a concurrent register cannot slip between", async () => {
      const order: string[] = [];
      mockedScheduleTask.mockImplementation(async () => {
        order.push("schedule");
        return true;
      });
      mockedStatusFindOne.mockImplementation(async () => {
        order.push("read-status");
        return { job: JOB_ID, state: "up" } as never;
      });

      await armStartupDeadline(db, deployment(), JOB_ID);

      expect(order).toEqual(["schedule", "read-status"]);
    });
  });
});
