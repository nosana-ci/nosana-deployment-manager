import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { setConfig } from "../../config/index.js";
import { HostManagerError, cancelReservationRequest, requestReservation } from "./index.js";

const fetchMock = vi.fn();

function respond(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
  );
}

describe("host-manager client: reservation requests", () => {
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

  it("requestReservation POSTs the request to /reservations/requests with the shared key", async () => {
    const body = {
      key: "64f1a2b3c4d5e6f708192a3b",
      status: "waiting",
      requested: 2,
      nodes: [],
      holdExpiresAt: null,
      expiresAt: "2026-10-10T12:15:00.000Z",
    };
    respond(200, body);

    const result = await requestReservation({ key: "64f1a2b3c4d5e6f708192a3b", market: "m1", requirements: { gpu_vram_gb: 24 }, count: 2, ttlSeconds: 900 });

    expect(result).toEqual(body);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://host-manager:3000/reservations/requests");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/json", authorization: "dm-key" });
    expect(JSON.parse(init.body)).toEqual({ key: "64f1a2b3c4d5e6f708192a3b", market: "m1", requirements: { gpu_vram_gb: 24 }, count: 2, ttlSeconds: 900 });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([422, 404, 503, 500])("requestReservation: an HTTP %i throws HostManagerError carrying the status", async (status) => {
    respond(status, { message: `failed with ${status}` });

    const error = await requestReservation({ key: "k", market: "m1", count: 1 }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HostManagerError);
    expect(error).toMatchObject({ status, message: `failed with ${status}` });
  });

  it("no response (network error) throws the fetch error, not a HostManagerError", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

    const error = await requestReservation({ key: "k", market: "m1", count: 1 }).catch((e: unknown) => e);

    expect(error).not.toBeInstanceOf(HostManagerError);
  });

  it("cancelReservationRequest DELETEs the key (the task id) with the shared key and no body", async () => {
    respond(200, { key: "64f1a2b3c4d5e6f708192a3c", status: "cancelled", released: 1 });

    const result = await cancelReservationRequest("64f1a2b3c4d5e6f708192a3c");

    expect(result).toEqual({ key: "64f1a2b3c4d5e6f708192a3c", status: "cancelled", released: 1 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://host-manager:3000/reservations/requests/64f1a2b3c4d5e6f708192a3c");
    expect(init.method).toBe("DELETE");
    expect(init.headers).toEqual({ authorization: "dm-key" });
    expect(init.body).toBeUndefined();
  });

  it("cancelReservationRequest throws HostManagerError on an error response", async () => {
    respond(401, { message: "Unauthorized" });

    await expect(cancelReservationRequest("k")).rejects.toMatchObject({ status: 401, message: "Unauthorized" });
  });

  it("refuses to call without the shared key configured", async () => {
    setConfig("host_manager_api_key", undefined);

    await expect(cancelReservationRequest("k")).rejects.toThrow("HOST_MANAGER_API_KEY is not configured");
    await expect(requestReservation({ key: "k", market: "m1", count: 1 })).rejects.toThrow(
      "HOST_MANAGER_API_KEY is not configured"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses to run without HOST_MANAGER_URL", async () => {
    setConfig("host_manager_url", undefined);

    await expect(requestReservation({ key: "k", market: "m1", count: 1 })).rejects.toThrow(
      "HOST_MANAGER_URL is not configured"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
