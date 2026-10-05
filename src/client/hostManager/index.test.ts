import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { setConfig } from "../../config/index.js";
import { classifyReservationError } from "../../tasks/idempotency/index.js";
import { HostManagerError, reserve } from "./index.js";

const fetchMock = vi.fn();

function respond(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
  );
}

describe("host-manager client: reserve", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    setConfig("host_manager_url", "http://host-manager:3000/");
    setConfig("host_manager_api_key", "dm-key");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setConfig("host_manager_url", undefined);
    setConfig("host_manager_api_key", undefined);
  });

  it("refuses to call without the shared key configured", async () => {
    setConfig("host_manager_api_key", undefined);

    await expect(reserve({ market: "m1", count: 1, idempotencyKey: "k" })).rejects.toThrow(
      "HOST_MANAGER_API_KEY is not configured"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs the body to /reservations and returns the typed response", async () => {
    const body = { requested: 2, reserved: 1, expiresAt: "2026-10-01T00:01:00.000Z", nodes: [{ nodeAddress: "n1", market: "m1" }] };
    respond(200, body);

    const result = await reserve({ market: "m1", requirements: { gpu_vram_gb: 24 }, count: 2, idempotencyKey: "t:reserve:0" });

    expect(result).toEqual(body);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://host-manager:3000/reservations");
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("dm-key");
    expect(JSON.parse(init.body)).toEqual({ market: "m1", requirements: { gpu_vram_gb: 24 }, count: 2, idempotencyKey: "t:reserve:0" });
  });

  it.each([
    [409, "IN_PROGRESS"],
    [422, "FATAL"],
    [404, "FATAL"],
    [503, "RETRY"],
    [500, "RETRY"],
  ])("an HTTP %i throws HostManagerError carrying the status, classified %s", async (status, action) => {
    respond(status, { message: `failed with ${status}` });

    const error = await reserve({ market: "m1", count: 1, idempotencyKey: "k" }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HostManagerError);
    expect(error).toMatchObject({ status, message: `failed with ${status}` });
    expect(classifyReservationError(error)).toBe(action);
  });

  it("no response (network error) is RETRY, never fatal: it may be a lost success", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

    const error = await reserve({ market: "m1", count: 1, idempotencyKey: "k" }).catch((e: unknown) => e);

    expect(error).not.toBeInstanceOf(HostManagerError);
    expect(classifyReservationError(error)).toBe("RETRY");
  });

  it("refuses to run without HOST_MANAGER_URL", async () => {
    setConfig("host_manager_url", undefined);

    await expect(reserve({ market: "m1", count: 1, idempotencyKey: "k" })).rejects.toThrow(
      "HOST_MANAGER_URL is not configured"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
