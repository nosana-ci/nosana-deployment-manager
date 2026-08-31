import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../repositories/index.js", () => ({
  JobsRepository: { findAll: vi.fn() },
  FrpsEndpointStatusRepository: { findAll: vi.fn() },
  DeploymentsRepository: { findOne: vi.fn(), collection: { updateOne: vi.fn() } },
}));

import { refreshDeploymentEndpointStatus } from "../deploymentEndpointStatus.js";
import {
  DeploymentsRepository,
  FrpsEndpointStatusRepository,
  JobsRepository,
} from "../../repositories/index.js";

import { type Endpoint, JobState } from "../../types/index.js";

const DEPLOYMENT = "deployment-1";

const mockedJobsFindAll = vi.mocked(JobsRepository.findAll);
const mockedTunnelFindAll = vi.mocked(FrpsEndpointStatusRepository.findAll);
const mockedDeploymentFindOne = vi.mocked(DeploymentsRepository.findOne);
const mockedUpdateOne = vi.mocked(DeploymentsRepository.collection.updateOne);

const runningJob = (job: string) => ({ job }) as never;
const upTunnel = (job: string, opId: string) => ({ job, opId, state: "up" }) as never;
const endpoint = (opId: string, online: boolean, port: number | string = 8080): Endpoint =>
  ({ opId, port, url: `https://${opId}.test`, online });
/** What the deployment's endpoints currently say. */
const withEndpoints = (endpoints: Endpoint[]) =>
  mockedDeploymentFindOne.mockResolvedValue({ id: DEPLOYMENT, endpoints } as never);

/** The single update a change to one opId should produce. */
const expectedUpdate = (opId: string, online: boolean) => [
  { id: DEPLOYMENT },
  { $set: { "endpoints.$[endpoint].online": online } },
  { arrayFilters: [{ "endpoint.opId": opId }] },
];

describe("refreshDeploymentEndpointStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedJobsFindAll.mockResolvedValue([]);
    mockedTunnelFindAll.mockResolvedValue([]);
    withEndpoints([endpoint("api", false)]);
    mockedUpdateOne.mockResolvedValue({ acknowledged: true } as never);
  });

  it("marks an endpoint online when its tunnel is up on a RUNNING job", async () => {
    mockedJobsFindAll.mockResolvedValue([runningJob("job-a")]);
    mockedTunnelFindAll.mockResolvedValue([upTunnel("job-a", "api")]);

    await refreshDeploymentEndpointStatus(DEPLOYMENT);

    expect(mockedUpdateOne).toHaveBeenCalledExactlyOnceWith(...expectedUpdate("api", true));
  });

  it("computes from source: RUNNING jobs and up tunnels only", async () => {
    await refreshDeploymentEndpointStatus(DEPLOYMENT);

    expect(mockedJobsFindAll).toHaveBeenCalledWith(
      { deployment: DEPLOYMENT, state: JobState.RUNNING },
      { projection: { job: 1 } },
    );
    expect(mockedTunnelFindAll).toHaveBeenCalledWith({ deploymentId: DEPLOYMENT, state: "up" });
  });

  it("writes nothing when the answer has not moved", async () => {
    mockedJobsFindAll.mockResolvedValue([runningJob("job-a")]);
    mockedTunnelFindAll.mockResolvedValue([upTunnel("job-a", "api")]);
    withEndpoints([endpoint("api", true)]);

    await refreshDeploymentEndpointStatus(DEPLOYMENT);

    // The deployment change stream drives the SSE frames, so a no-op write would
    // restate every endpoint to every watcher for nothing.
    expect(mockedUpdateOne).not.toHaveBeenCalled();
  });

  it("takes an endpoint offline when its last RUNNING job has gone", async () => {
    // The tunnel row still reads up — it is never deleted — so the job is what retires it.
    mockedJobsFindAll.mockResolvedValue([]);
    mockedTunnelFindAll.mockResolvedValue([upTunnel("dead-job", "api")]);
    withEndpoints([endpoint("api", true)]);

    await refreshDeploymentEndpointStatus(DEPLOYMENT);

    expect(mockedUpdateOne).toHaveBeenCalledExactlyOnceWith(...expectedUpdate("api", false));
  });

  it("stays online while any one replica still serves the endpoint", async () => {
    mockedJobsFindAll.mockResolvedValue([runningJob("job-b")]);
    mockedTunnelFindAll.mockResolvedValue([upTunnel("job-a", "api"), upTunnel("job-b", "api")]);
    withEndpoints([endpoint("api", true)]);

    await refreshDeploymentEndpointStatus(DEPLOYMENT);

    expect(mockedUpdateOne).not.toHaveBeenCalled();
  });

  it("updates an op's ports in one write, since they share a tunnel", async () => {
    mockedJobsFindAll.mockResolvedValue([runningJob("job-a")]);
    mockedTunnelFindAll.mockResolvedValue([upTunnel("job-a", "api")]);
    withEndpoints([endpoint("api", false, 8080), endpoint("api", false, 9090)]);

    await refreshDeploymentEndpointStatus(DEPLOYMENT);

    // One update, matched on opId — arrayFilters covers both entries.
    expect(mockedUpdateOne).toHaveBeenCalledExactlyOnceWith(...expectedUpdate("api", true));
  });

  it("moves only the endpoints that changed", async () => {
    mockedJobsFindAll.mockResolvedValue([runningJob("job-a")]);
    mockedTunnelFindAll.mockResolvedValue([upTunnel("job-a", "api")]);
    withEndpoints([endpoint("api", false), endpoint("ui", false)]);

    await refreshDeploymentEndpointStatus(DEPLOYMENT);

    expect(mockedUpdateOne).toHaveBeenCalledExactlyOnceWith(...expectedUpdate("api", true));
  });

  it("never touches updated_at, which gates the rapid-completion fail-safe", async () => {
    mockedJobsFindAll.mockResolvedValue([runningJob("job-a")]);
    mockedTunnelFindAll.mockResolvedValue([upTunnel("job-a", "api")]);

    await refreshDeploymentEndpointStatus(DEPLOYMENT);

    const [, update] = mockedUpdateOne.mock.calls[0];
    expect(JSON.stringify(update)).not.toContain("updated_at");
  });

  it("does nothing for a deployment that exposes no endpoints", async () => {
    withEndpoints([]);

    await refreshDeploymentEndpointStatus(DEPLOYMENT);

    expect(mockedJobsFindAll).not.toHaveBeenCalled();
    expect(mockedUpdateOne).not.toHaveBeenCalled();
  });

  it("does nothing for a deployment that no longer exists", async () => {
    mockedDeploymentFindOne.mockResolvedValue(null);

    await refreshDeploymentEndpointStatus(DEPLOYMENT);

    expect(mockedUpdateOne).not.toHaveBeenCalled();
  });
});

