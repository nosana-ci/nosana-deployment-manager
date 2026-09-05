import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";

const scheduleTask = vi.fn();
vi.mock("../../../tasks/scheduleTask.js", () => ({
  scheduleTask: (...a: unknown[]) => scheduleTask(...a),
}));

const jobsFindAll = vi.fn();
vi.mock("../../../repositories/index.js", () => ({
  JobsRepository: { findAll: (...a: unknown[]) => jobsFindAll(...a) },
}));

const disarmStartupDeadline = vi.fn();
vi.mock("../../infinite/utils/armStartupDeadline.js", () => ({
  disarmStartupDeadline: (...a: unknown[]) => disarmStartupDeadline(...a),
}));

import { deploymentMarketUpdate } from "../deploymentMarketUpdate.js";
import {
  DeploymentDocumentFields,
  DeploymentStatus,
  DeploymentStrategy,
  JobState,
  TaskType,
  type DeploymentDocument,
} from "../../../types/index.js";
import { OnEvent } from "../../../client/listener/types.js";

const [eventType, handler, options] = deploymentMarketUpdate;
const db = {} as Db;

const NEW_MARKET = "market-new";

const deployment = (strategy: DeploymentStrategy): DeploymentDocument =>
  ({
    id: "dep-1",
    status: DeploymentStatus.RUNNING,
    strategy,
    market: NEW_MARKET,
  }) as unknown as DeploymentDocument;

beforeEach(() => {
  scheduleTask.mockReset().mockResolvedValue(true);
  jobsFindAll.mockReset().mockResolvedValue([{ job: "j1" }, { job: "j2" }]);
  disarmStartupDeadline.mockReset().mockResolvedValue({ cancelled: false, startup: false });
});

describe("deploymentMarketUpdate — configuration", () => {
  it("is an UPDATE listener keyed on the MARKET field", () => {
    expect(eventType).toBe(OnEvent.UPDATE);
    expect(options?.fields).toEqual([DeploymentDocumentFields.MARKET]);
  });

  it("only fires for RUNNING deployments", () => {
    expect(options?.filters).toEqual({ status: { $eq: DeploymentStatus.RUNNING } });
  });
});

describe("deploymentMarketUpdate — behavior", () => {
  it("only considers active jobs that are not already on the new market", async () => {
    await handler(deployment(DeploymentStrategy.INFINITE), db);

    expect(jobsFindAll).toHaveBeenCalledWith(
      {
        deployment: "dep-1",
        market: { $ne: NEW_MARKET },
        state: { $in: [JobState.QUEUED, JobState.RUNNING] },
      },
      expect.anything()
    );
  });

  it("does nothing when every active job is already on the new market", async () => {
    jobsFindAll.mockResolvedValueOnce([]);

    await handler(deployment(DeploymentStrategy.SIMPLE), db);

    expect(scheduleTask).not.toHaveBeenCalled();
    expect(disarmStartupDeadline).not.toHaveBeenCalled();
  });

  it.each([DeploymentStrategy.INFINITE, DeploymentStrategy.SCHEDULED])(
    "schedules one targeted STOP per displaced job and no LIST on %s",
    async (strategy) => {
      await handler(deployment(strategy), db);

      expect(scheduleTask).toHaveBeenCalledTimes(2);
      for (const job of ["j1", "j2"]) {
        expect(scheduleTask).toHaveBeenCalledWith(
          db,
          TaskType.STOP,
          "dep-1",
          DeploymentStatus.RUNNING,
          expect.any(Date),
          { job }
        );
      }
    }
  );

  it.each([DeploymentStrategy.SIMPLE, DeploymentStrategy["SIMPLE-EXTEND"]])(
    "also queues one LIST for the stopped count, ahead of the stops, on %s",
    async (strategy) => {
      await handler(deployment(strategy), db);

      expect(scheduleTask).toHaveBeenCalledTimes(3);
      expect(scheduleTask).toHaveBeenNthCalledWith(
        1,
        db,
        TaskType.LIST,
        "dep-1",
        DeploymentStatus.RUNNING,
        expect.any(Date),
        { limit: 2 }
      );
      expect(scheduleTask.mock.calls.slice(1).map((call) => call[1])).toEqual([
        TaskType.STOP,
        TaskType.STOP,
      ]);
    }
  );

  it("disarms each job's startup deadline before scheduling its stop", async () => {
    await handler(deployment(DeploymentStrategy.INFINITE), db);

    expect(disarmStartupDeadline).toHaveBeenCalledWith("dep-1", "j1");
    expect(disarmStartupDeadline).toHaveBeenCalledWith("dep-1", "j2");
    expect(disarmStartupDeadline.mock.invocationCallOrder[0]).toBeLessThan(
      scheduleTask.mock.invocationCallOrder[0]
    );
  });
});
