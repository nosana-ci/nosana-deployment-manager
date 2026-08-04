import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../../repositories/index.js", () => ({
  TasksRepository: { collection: { deleteOne: vi.fn() } },
  EventsRepository: { create: vi.fn() },
  FrpsEndpointStatusRepository: { collection: { updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }) } },
}));

import { frpsRegisterHandler } from "../registerHandler.js";
import { EventsRepository, TasksRepository, FrpsEndpointStatusRepository } from "../../../../repositories/index.js";

import { EventType, TaskStatus, TaskType } from "../../../../types/index.js";
import { FRPSEventTypes, type RegisteredEvent } from "../../../../listeners/frps/types.js";

const NOW = new Date("2026-07-21T12:00:00Z");
const DEPLOYMENT_ID = "deployment-1";
const JOB_ID = "job-1";

const mockedDeleteOne = vi.mocked(TasksRepository.collection.deleteOne);
const mockedEventsCreate = vi.mocked(EventsRepository.create);
const mockedStatusUpdate = vi.mocked(FrpsEndpointStatusRepository.collection.updateOne);

function createEvent(metadatas?: RegisteredEvent["metadatas"]): RegisteredEvent {
  return {
    type: FRPSEventTypes.REGISTERED,
    proxyName: "proxy-1",
    proxyType: "http",
    timestamp: NOW.getTime(),
    metadatas,
  };
}

const validEvent = createEvent([{ deploymentId: DEPLOYMENT_ID, opId: "op-1", jobId: JOB_ID }]);

describe("frpsRegisterHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mockedDeleteOne.mockResolvedValue({ deletedCount: 1, acknowledged: true } as never);
    mockedStatusUpdate.mockResolvedValue({ matchedCount: 1 } as never);
  });

  it("marks the endpoint up", async () => {
    await frpsRegisterHandler(validEvent);

    expect(mockedStatusUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ job: JOB_ID, opId: "op-1", state: { $ne: "up" } }),
      expect.anything(),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("cancels the pending stop for the reconnected job", async () => {
    await frpsRegisterHandler(validEvent);

    expect(mockedDeleteOne).toHaveBeenCalledExactlyOnceWith({
      task: TaskType.STOP,
      deploymentId: DEPLOYMENT_ID,
      job: JOB_ID,
      status: TaskStatus.PENDING,
      // `due_at > now` is what keeps this from racing the consumer: a task the
      // consumer could already have claimed is necessarily due, so it can never
      // match this filter.
      due_at: { $gt: NOW },
    });
  });

  it("records that the stop was cancelled", async () => {
    await frpsRegisterHandler(validEvent);

    expect(mockedEventsCreate).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        category: EventType.DEPLOYMENT,
        deploymentId: DEPLOYMENT_ID,
        type: "FRPS_TUNNEL_RECOVERED",
      })
    );
  });

  it("stays quiet when there was no pending stop to cancel", async () => {
    mockedDeleteOne.mockResolvedValue({ deletedCount: 0, acknowledged: true } as never);

    await frpsRegisterHandler(validEvent);

    expect(mockedEventsCreate).not.toHaveBeenCalled();
  });

  it("ignores an event with no jobId, so it can never cancel another job's stop", async () => {
    await frpsRegisterHandler(createEvent([{ deploymentId: DEPLOYMENT_ID }]));

    expect(mockedDeleteOne).not.toHaveBeenCalled();
  });

  it("ignores an event with no metadata", async () => {
    await frpsRegisterHandler(createEvent());

    expect(mockedDeleteOne).not.toHaveBeenCalled();
  });

  it("resolves the job from metadata split across several objects", async () => {
    await frpsRegisterHandler(createEvent([{ deploymentId: DEPLOYMENT_ID }, { jobId: JOB_ID }]));

    expect(mockedDeleteOne).toHaveBeenCalledOnce();
  });
});
