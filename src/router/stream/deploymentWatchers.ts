import type { WithId } from "mongodb";

import type {
  DeploymentDocument,
  Endpoint,
  EventDocument,
  JobsDocument,
  TaskDocument,
  TaskType,
} from "../../types/index.js";
import type { DeploymentStreamEventSchema } from "../schema/index.schema.js";

/**
 * One frame of the stream, derived from the schema that describes it in the
 * OpenAPI document so the two cannot disagree. Edit
 * `DeploymentStreamEventSchema` to change what may be emitted.
 */
export type DeploymentStreamEvent = DeploymentStreamEventSchema;

/** One SSE connection: where its deployment's events go, and how to end it. */
export type DeploymentListener = {
  send: (event: DeploymentStreamEvent) => void;
  close: () => void;
};

type TrackedTask = { deploymentId: string; task: TaskType };

export function toDeploymentEvent(doc: DeploymentDocument): DeploymentStreamEvent {
  return {
    type: "deployment",
    status: doc.status,
    replicas: doc.replicas,
    active_revision: doc.active_revision,
  };
}

export function toJobEvent(doc: JobsDocument): DeploymentStreamEvent {
  return {
    type: "job",
    job: doc.job,
    state: doc.state,
    node: doc.node,
    timeStart: doc.time_start,
    timeEnd: doc.time_end ?? 0,
    revision: doc.revision,
    created_at: doc.created_at.toISOString(),
  };
}

/**
 * The authoritative set of a deployment's active jobs at connect time, by id.
 * Sent once when the stream opens so a reconnecting client can prune any job it
 * still shows that is no longer active: a completion reached while disconnected
 * is never replayed as a live frame, so its absence here is the only signal.
 */
export function toJobsSnapshotEvent(jobs: JobsDocument[]): DeploymentStreamEvent {
  return { type: "jobs", jobs: jobs.map((job) => job.job) };
}

export function toLogEvent(doc: EventDocument): DeploymentStreamEvent {
  return {
    type: "event",
    category: doc.category,
    event: doc.type,
    message: doc.message,
    tx: doc.tx ?? null,
    created_at: doc.created_at.toISOString(),
  };
}

export function toTaskEvent(doc: WithId<TaskDocument>): DeploymentStreamEvent {
  return {
    type: "task",
    id: String(doc._id),
    task: doc.task,
    status: doc.status,
    attempts: doc.attempts,
    due_at: doc.due_at.toISOString(),
    job: doc.job ?? null,
  };
}

export function toTaskDoneEvent(id: string, task: TaskType): DeploymentStreamEvent {
  return { type: "task", id, task, status: "DONE" };
}

/**
 * One frame per endpoint, carrying the endpoint itself — url included — rather
 * than a status delta, so it matches what the deployment routes return and a
 * client needs nothing else to render it.
 *
 * One frame per entry, not per tunnel: several ports of an op share reachability
 * and so repeat the same value, but each entry is a row the client displays.
 */
export function toEndpointEvents(endpoints: Endpoint[] = []): DeploymentStreamEvent[] {
  return endpoints.map((endpoint) => ({ type: "endpoint", ...endpoint }));
}

/** The deployments with open SSE connections on this process, and those connections. */
export function createDeploymentWatchers() {
  const watchers = new Map<string, Set<DeploymentListener>>();
  // A task's deletion arrives as a bare id, so remember which deployment each
  // outstanding task of a watched deployment belongs to.
  const tasks = new Map<string, TrackedTask>();

  return {
    /** Register a connection; call the returned function when it closes. */
    watch(deploymentId: string, listener: DeploymentListener): () => void {
      let listeners = watchers.get(deploymentId);
      if (!listeners) watchers.set(deploymentId, (listeners = new Set<DeploymentListener>()));
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
        // A repeated unwatch must not drop connections registered since the first.
        if (listeners.size === 0 && watchers.get(deploymentId) === listeners) {
          watchers.delete(deploymentId);
        }
      };
    },
    has(deploymentId: string): boolean {
      return watchers.has(deploymentId);
    },
    count(deploymentId: string): number {
      return watchers.get(deploymentId)?.size ?? 0;
    },
    notify(deploymentId: string, event: DeploymentStreamEvent): void {
      watchers.get(deploymentId)?.forEach((listener) => listener.send(event));
    },
    /** End every connection, so a server shutting down is not held open by them. */
    closeAll(): void {
      const open = [...watchers.values()].flatMap((listeners) => [...listeners]);
      open.forEach((listener) => listener.close());
    },
    trackTask(taskId: string, deploymentId: string, task: TaskType): void {
      tasks.set(taskId, { deploymentId, task });
    },
    /** Forget a task, returning what was known about it. */
    untrackTask(taskId: string): TrackedTask | undefined {
      const tracked = tasks.get(taskId);
      tasks.delete(taskId);
      return tracked;
    },
  };
}

export type DeploymentWatchers = ReturnType<typeof createDeploymentWatchers>;
