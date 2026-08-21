import type { WithId } from "mongodb";

import type {
  DeploymentDocument,
  DeploymentStatus,
  EventDocument,
  EventType,
  JobsDocument,
  JobState,
  TaskDocument,
  TaskStatus,
  TaskType,
} from "../../types/index.js";

export type DeploymentStreamEvent =
  | { type: "deployment"; status: DeploymentStatus; replicas: number; active_revision: number }
  | { type: "job"; job: string; state: JobState; node: string | null; timeStart: number; timeEnd: number }
  /** A new entry in the deployment's event log; `event` is the entry's own type. */
  | { type: "event"; category: EventType; event: string; message: string; tx: string | null; created_at: string }
  | { type: "task"; id: string; task: TaskType; status: TaskStatus; attempts: number; due_at: string; job: string | null }
  /** The task left the queue: completed, or cancelled along with its deployment. */
  | { type: "task"; id: string; task: TaskType; status: "DONE" };

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
  };
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
