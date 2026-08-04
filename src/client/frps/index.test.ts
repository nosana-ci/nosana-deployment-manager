import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { fetchLiveProxies } from "./index.js";
import { setConfig } from "../../config/index.js";

function proxyListResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as Response;
}

function onlineProxy(name: string, metadatas: Record<string, string>) {
  return { name, status: "online", conf: { metadatas } };
}

describe("fetchLiveProxies", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    setConfig("frps_internal_address", "frps.internal:7501");
    setConfig("frps_internal_use_tls", false);
    setConfig("frps_api_key", "secret");
    setConfig("frps_api_timeout_ms", 5_000);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("returns null rather than an empty map when the list can't be trusted", () => {
    // This is the safety property the whole feature rests on: an empty map means
    // "FRPS says nothing is live" and stops every job, so any uncertainty MUST
    // surface as null instead.

    it("on a non-2xx response", async () => {
      fetchMock.mockResolvedValue(proxyListResponse({ proxies: [] }, false, 503));

      expect(await fetchLiveProxies()).toBeNull();
    });

    it("on a network error or timeout", async () => {
      fetchMock.mockRejectedValue(new Error("timed out"));

      expect(await fetchLiveProxies()).toBeNull();
    });

    it("on a body that is not valid JSON", async () => {
      fetchMock.mockResolvedValue(proxyListResponse("<html>502 Bad Gateway</html>"));

      expect(await fetchLiveProxies()).toBeNull();
    });

    it("on a body with no proxies array", async () => {
      fetchMock.mockResolvedValue(proxyListResponse({ unexpected: true }));

      expect(await fetchLiveProxies()).toBeNull();
    });

    it("when no internal address is configured, without calling out", async () => {
      setConfig("frps_internal_address", "");

      expect(await fetchLiveProxies()).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("an empty live set is distinct from a failure", () => {
    it("returns an empty array when FRPS genuinely reports no proxies", async () => {
      fetchMock.mockResolvedValue(proxyListResponse({ proxies: [] }));

      const live = await fetchLiveProxies();

      expect(live).not.toBeNull();
      expect(live).toHaveLength(0);
    });
  });

  describe("parsing", () => {
    it("reads jobId, opId and deploymentId off online proxies", async () => {
      fetchMock.mockResolvedValue(
        proxyListResponse({
          proxies: [onlineProxy("hash-op-dp", { deploymentId: "dep-1", jobId: "job-1", opId: "op-1" })],
        })
      );

      const live = await fetchLiveProxies();

      expect(live).toEqual([
        { name: "hash-op-dp", jobId: "job-1", opId: "op-1", deploymentId: "dep-1" },
      ]);
    });

    it("keeps every proxy of a multi-op job", async () => {
      fetchMock.mockResolvedValue(
        proxyListResponse({
          proxies: [
            onlineProxy("a-dp", { jobId: "job-1", opId: "op-a" }),
            onlineProxy("b-dp", { jobId: "job-1", opId: "op-b" }),
          ],
        })
      );

      const live = await fetchLiveProxies();

      expect(live).toHaveLength(2);
      expect(live?.map((p) => p.opId)).toEqual(["op-a", "op-b"]);
    });

    it("drops offline proxies, which carry a null conf and are uncorrelatable", async () => {
      fetchMock.mockResolvedValue(
        proxyListResponse({
          proxies: [
            { name: "hash-op-dp", status: "offline", conf: null },
            onlineProxy("other-dp", { jobId: "job-2" }),
          ],
        })
      );

      const live = await fetchLiveProxies();

      expect(live).toHaveLength(1);
      expect(live?.[0].jobId).toBe("job-2");
    });

    it("drops proxies with no jobId, such as the plain per-job proxy", async () => {
      fetchMock.mockResolvedValue(
        proxyListResponse({ proxies: [onlineProxy("hash-op", { opId: "op-1" })] })
      );

      expect(await fetchLiveProxies()).toHaveLength(0);
    });

    it("tolerates malformed entries without discarding the whole list", async () => {
      fetchMock.mockResolvedValue(
        proxyListResponse({
          proxies: [
            null,
            { status: "online" },
            { name: 42, status: "online", conf: { metadatas: { jobId: "job-x" } } },
            onlineProxy("good-dp", { jobId: "job-3" }),
          ],
        })
      );

      const live = await fetchLiveProxies();

      expect(live).toHaveLength(1);
      expect(live?.[0].jobId).toBe("job-3");
    });
  });

  describe("request", () => {
    it("calls the proxy list over http with the api key", async () => {
      fetchMock.mockResolvedValue(proxyListResponse({ proxies: [] }));

      await fetchLiveProxies();

      expect(fetchMock).toHaveBeenCalledWith(
        "http://frps.internal:7501/api/proxy/http",
        expect.objectContaining({ headers: { "X-API-Key": "secret" } })
      );
    });

    it("uses https when tls is enabled and omits the header with no key", async () => {
      setConfig("frps_internal_use_tls", true);
      setConfig("frps_api_key", undefined);
      fetchMock.mockResolvedValue(proxyListResponse({ proxies: [] }));

      await fetchLiveProxies();

      expect(fetchMock).toHaveBeenCalledWith(
        "https://frps.internal:7501/api/proxy/http",
        expect.objectContaining({ headers: {} })
      );
    });
  });
});
