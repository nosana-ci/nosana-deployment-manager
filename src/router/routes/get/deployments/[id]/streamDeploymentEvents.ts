import type { RouteHandler } from "fastify";

import { ErrorMessages } from "../../../../../errors/index.js";
import {
  toDeploymentEvent,
  toEndpointEvents,
  toJobEvent,
  toTaskEvent,
  type DeploymentStreamEvent,
} from "../../../../stream/deploymentWatchers.js";

import type { HeadersSchema } from "../../../../schema/index.schema.js";
import { ACTIVE_JOB_STATES } from "../../../../../types/index.js";

/** Keep idle streams alive through proxy timeouts. */
const HEARTBEAT_INTERVAL_MS = 25_000;

/** Stream a deployment's status and job-state changes as server-sent events. */
export const streamDeploymentEventsHandler: RouteHandler<{
  Params: { deployment: string };
  Headers: HeadersSchema;
}> = async (req, res) => {
  const { db, deploymentWatchers } = res.locals;
  const deployment = res.locals.deployment!;

  const snapshot = await Promise.all([
    db.jobs
      .find({ deployment: deployment.id, state: { $in: ACTIVE_JOB_STATES } })
      .sort({ created_at: 1 })
      .toArray(),
    db.tasks.find({ deploymentId: deployment.id }).sort({ due_at: 1 }).toArray(),
  ]).catch((error: unknown) => {
    req.log.error(error);
    return null;
  });

  // Refuse rather than open a stream that ends at once: EventSource stops on a
  // non-200 instead of retrying every few seconds.
  if (!snapshot) {
    res.status(503).send({ error: ErrorMessages.generic.SOMETHING_WENT_WRONG });
    return;
  }

  // The client may have left during the lookups above; there is no one to answer.
  if (res.raw.destroyed) {
    res.hijack();
    return;
  }

  // From here the handler owns the open response.
  res.hijack();

  // Hijacking bypasses Fastify's reply, so carry over what plugins set (CORS).
  for (const [name, value] of Object.entries(res.getHeaders())) {
    if (value !== undefined) res.raw.setHeader(name, value);
  }
  res.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Nginx buffers proxied responses by default, which would hold events back.
    "X-Accel-Buffering": "no",
  });

  const closed = () => res.raw.writableEnded || res.raw.destroyed;

  const send = (event: DeploymentStreamEvent) => {
    if (!closed()) res.raw.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const heartbeat = setInterval(() => {
    if (!closed()) res.raw.write(": keep-alive\n\n");
  }, HEARTBEAT_INTERVAL_MS);

  const close = () => {
    clearInterval(heartbeat);
    unwatch();
    if (!closed()) res.raw.end();
  };

  // Subscribe only now, with the snapshot in hand, so live changes always follow
  // it. A change landing between the middleware lookup and here is not replayed:
  // buffering it would hand the client duplicate and transiently out-of-order
  // events, which we chose against.
  const unwatch = deploymentWatchers.watch(deployment.id, { send, close });
  res.raw.on("close", close);

  const [activeJobs, outstandingTasks] = snapshot;
  // Their deletions must find their way back to this deployment.
  outstandingTasks.forEach((task) => deploymentWatchers.trackTask(String(task._id), deployment.id, task.task));

  send(toDeploymentEvent(deployment));
  activeJobs.map(toJobEvent).forEach(send);
  outstandingTasks.map(toTaskEvent).forEach(send);
  toEndpointEvents(deployment.endpoints).forEach(send);
};
