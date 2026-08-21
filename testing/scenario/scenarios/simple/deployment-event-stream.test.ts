import { expect } from "vitest";
import type { Deployment } from "@nosana/api";
import { DeploymentStrategy } from "@nosana/kit";

import { createFlow, createState } from "../../utils/index.js";
import {
  checkSufficientVaultBalance,
  createDeployment,
  joinMarketQueue,
  startDeployment,
  stopDeployment,
} from "../../common/index.js";
import { deployerClient } from "../../setup.js";

type StreamEvent =
  | { type: "deployment"; status: string; replicas: number; active_revision: number }
  | { type: "job"; job: string; state: string; node: string | null; timeStart: number; timeEnd: number };

type DeploymentStream = {
  next: (predicate: (event: StreamEvent) => boolean) => Promise<StreamEvent>;
  close: () => void;
};

const openStream = async (deploymentId: string): Promise<DeploymentStream> => {
  const controller = new AbortController();
  const authorization = await deployerClient.authorization.generate("NosanaApiAuthentication");
  const response = await fetch(`${process.env.BACKEND_URL}/api/deployments/${deploymentId}/stream`, {
    headers: {
      authorization,
      "x-user-id": deployerClient.wallet!.address.toString(),
    },
    signal: controller.signal,
  });

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const events: StreamEvent[] = [];
  let buffer = "";

  const parseFrames = () => {
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = frame
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice("data: ".length);
      if (data) events.push(JSON.parse(data) as StreamEvent);
      boundary = buffer.indexOf("\n\n");
    }
  };

  return {
    async next(predicate) {
      const timeout = setTimeout(() => controller.abort(), 30_000);
      try {
        while (true) {
          const index = events.findIndex(predicate);
          if (index >= 0) return events.splice(index, 1)[0]!;

          const { value, done } = await reader.read();
          if (done) throw new Error("deployment event stream ended before the expected event");
          buffer += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
          parseFrames();
        }
      } catch (error) {
        if (controller.signal.aborted) {
          throw new Error("timed out waiting for a deployment stream event", { cause: error });
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    },
    close() {
      controller.abort();
    },
  };
};

createFlow("Deployment Event Stream", (step) => {
  const deployment = createState<Deployment>();
  const stream = createState<DeploymentStream>();
  const runningJob = createState<string>();
  const startedAt = createState<number>();

  step("creates a simple deployment", createDeployment(deployment, {
    name: "Scenario testing: simple > deployment event stream",
    strategy: DeploymentStrategy.SIMPLE,
  }));

  step("rejects an unauthenticated stream", async () => {
    const response = await fetch(
      `${process.env.BACKEND_URL}/api/deployments/${deployment.get().id}/stream`,
    );
    expect(response.status).toBe(401);
  });

  step("opens an authenticated stream with the current deployment", async () => {
    const connection = await openStream(deployment.get().id);
    stream.set(connection);
    const initial = await connection.next((event) => event.type === "deployment");
    console.log("[SSE E2E] deployment", deployment.get().id);
    console.log("[SSE E2E] initial", JSON.stringify(initial));
    expect(initial).toMatchObject({ type: "deployment", status: deployment.get().status });
  });

  step("checks the vault and joins the market queue", async () => {
    await checkSufficientVaultBalance(deployment)();
    await joinMarketQueue(() => deployment.get().market)();
  });

  step("starts the deployment", async () => {
    startedAt.set(Date.now());
    await startDeployment(deployment)();
  });

  step("receives the claimed job live", async () => {
    const event = await stream.get().next(
      (candidate) => candidate.type === "job" && candidate.state === "RUNNING",
    );
    expect(event).toMatchObject({ type: "job", state: "RUNNING" });
    if (event.type !== "job") throw new Error("expected a job event");
    expect(event.node).not.toBeNull();
    expect(event.timeStart).toBeGreaterThan(0);
    runningJob.set(event.job);
    console.log(`[SSE E2E] live +${Date.now() - startedAt.get()}ms`, JSON.stringify(event));
  });

  step("replays the running job after reconnect", async () => {
    stream.get().close();
    const reconnected = await openStream(deployment.get().id);
    stream.set(reconnected);
    const snapshot = await reconnected.next(
      (candidate) => candidate.type === "job" && candidate.job === runningJob.get(),
    );
    expect(snapshot).toMatchObject({
      type: "job",
      job: runningJob.get(),
      state: "RUNNING",
    });
    console.log("[SSE E2E] reconnect snapshot", JSON.stringify(snapshot));
  });

  step("stops the deployment and closes the stream", async () => {
    await stopDeployment(deployment)();
    stream.get().close();
  });
});
