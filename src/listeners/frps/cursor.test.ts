import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../repositories/index.js", () => ({
  FrpsStreamCursorRepository: { findOne: vi.fn(), createOrUpdate: vi.fn() },
}));

import { readCursor, createCursorWriter } from "./cursor.js";
import { FrpsStreamCursorRepository } from "../../repositories/index.js";

const mockedFindOne = vi.mocked(FrpsStreamCursorRepository.findOne);
const mockedCreateOrUpdate = vi.mocked(FrpsStreamCursorRepository.createOrUpdate);

describe("readCursor", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the persisted resume point", async () => {
    mockedFindOne.mockResolvedValue({ _id: "frps", last_event_id: "42" } as never);
    expect(await readCursor()).toBe("42");
  });

  it("returns undefined when nothing has been stored", async () => {
    mockedFindOne.mockResolvedValue(null);
    expect(await readCursor()).toBeUndefined();
  });
});

describe("createCursorWriter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockedCreateOrUpdate.mockResolvedValue({} as never);
  });

  afterEach(() => vi.useRealTimers());

  it("persists at most once per throttle window, with the latest id", async () => {
    const writer = createCursorWriter(2_000);

    writer.record("1");
    writer.record("2");
    writer.record("3");

    expect(mockedCreateOrUpdate).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2_000);

    expect(mockedCreateOrUpdate).toHaveBeenCalledTimes(1);
    expect(mockedCreateOrUpdate).toHaveBeenCalledWith(
      { _id: "frps" },
      expect.objectContaining({ last_event_id: "3" }),
    );
  });

  it("flushes the latest id immediately on stop", async () => {
    const writer = createCursorWriter(60_000);

    writer.record("7");
    await writer.stop();

    expect(mockedCreateOrUpdate).toHaveBeenCalledWith(
      { _id: "frps" },
      expect.objectContaining({ last_event_id: "7" }),
    );
  });

  it("does not rewrite an id it already persisted", async () => {
    const writer = createCursorWriter(1_000);

    writer.record("5");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mockedCreateOrUpdate).toHaveBeenCalledTimes(1);

    writer.record("5");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mockedCreateOrUpdate).toHaveBeenCalledTimes(1);
  });

  it("ignores empty ids", async () => {
    const writer = createCursorWriter(1_000);

    writer.record("");
    await vi.advanceTimersByTimeAsync(1_000);

    expect(mockedCreateOrUpdate).not.toHaveBeenCalled();
  });
});
