import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";

vi.mock("../../client/eventSource/index.js", () => ({
  createEventSource: vi.fn(() => ({ on: vi.fn(), close: vi.fn() })),
}));

import { startFrpsListener } from "./index.js";
import { createEventSource } from "../../client/eventSource/index.js";
import { setConfig } from "../../config/index.js";

const mockedCreateEventSource = vi.mocked(createEventSource);

const db = {} as Db;

describe("startFrpsListener", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedCreateEventSource.mockReturnValue({ on: vi.fn(), close: vi.fn() });
    setConfig("frps_watching_enabled", true);
    setConfig("frps_internal_address", "frps.frps.svc.cluster.local");
    setConfig("frps_internal_use_tls", false);
    setConfig("frps_api_key", "secret");
  });

  it("does not subscribe when the kill-switch is off", async () => {
    setConfig("frps_watching_enabled", false);

    const handle = await startFrpsListener(db);

    expect(mockedCreateEventSource).not.toHaveBeenCalled();
    await expect(handle.stop()).resolves.not.toThrow();
  });

  it("does not subscribe when no internal address is configured", async () => {
    setConfig("frps_internal_address", "");

    await startFrpsListener(db);

    expect(mockedCreateEventSource).not.toHaveBeenCalled();
  });

  it("subscribes over http with the api key header", async () => {
    await startFrpsListener(db);

    expect(mockedCreateEventSource).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        url: "http://frps.frps.svc.cluster.local/api/conn/events",
        headers: { "X-API-Key": "secret" },
      })
    );
  });

  it("subscribes over https when tls is enabled", async () => {
    setConfig("frps_internal_use_tls", true);

    await startFrpsListener(db);

    expect(mockedCreateEventSource).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://frps.frps.svc.cluster.local/api/conn/events",
      })
    );
  });

  it("sends no auth header when no api key is configured", async () => {
    setConfig("frps_api_key", undefined);

    await startFrpsListener(db);

    expect(mockedCreateEventSource).toHaveBeenCalledWith(
      expect.objectContaining({ headers: {} })
    );
  });

  it("registers a handler for the registered and unregistered events", async () => {
    const on = vi.fn();
    mockedCreateEventSource.mockReturnValue({ on, close: vi.fn() });

    await startFrpsListener(db);

    expect(on).toHaveBeenCalledWith("registered", expect.any(Function));
    expect(on).toHaveBeenCalledWith("unregistered", expect.any(Function));
  });

  it("closes the stream on stop", async () => {
    const close = vi.fn();
    mockedCreateEventSource.mockReturnValue({ on: vi.fn(), close });

    const handle = await startFrpsListener(db);
    await handle.stop();

    expect(close).toHaveBeenCalledOnce();
  });
});
