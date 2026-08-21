import type { FastifyBaseLogger } from "fastify";
import { Db, type WithId } from "mongodb";

import { createCollectionListener } from "../../client/listener/index.js";
import { NosanaCollections } from "../../definitions/collection.js";
import {
  toDeploymentEvent,
  toJobEvent,
  toLogEvent,
  toTaskDoneEvent,
  toTaskEvent,
  type DeploymentWatchers,
} from "./deploymentWatchers.js";

import type { DeploymentDocument, EventDocument, JobsDocument, TaskDocument } from "../../types/index.js";

/** How long to wait before reopening the change streams after they fail. */
export const REOPEN_DELAY_MS = 5_000;

/** The fields the stream reports; updates to anything else are not worth a frame. */
const DEPLOYMENT_FIELDS: (keyof DeploymentDocument)[] = ["status", "replicas", "active_revision"];
const JOB_FIELDS: (keyof JobsDocument)[] = ["state", "node", "time_start", "time_end"];
const TASK_FIELDS: (keyof TaskDocument)[] = ["status", "attempts", "due_at"];

/**
 * Forward deployment, job, event-log and task changes to the connections
 * watching their deployment. Runs alongside the API; a change to an unwatched
 * deployment is dropped before any other work is done.
 */
export function startDeploymentChangeListener(
  db: Db,
  watchers: DeploymentWatchers,
  log: Pick<FastifyBaseLogger, "error">
): { stop: () => Promise<void> } {
  const onDeploymentChange = (doc: DeploymentDocument) => {
    if (watchers.has(doc.id)) watchers.notify(doc.id, toDeploymentEvent(doc));
  };

  const onJobChange = (doc: JobsDocument) => {
    if (watchers.has(doc.deployment)) watchers.notify(doc.deployment, toJobEvent(doc));
  };

  const onLogEvent = (doc: EventDocument) => {
    if (watchers.has(doc.deploymentId)) watchers.notify(doc.deploymentId, toLogEvent(doc));
  };

  const onTaskChange = (doc: WithId<TaskDocument>) => {
    if (!watchers.has(doc.deploymentId)) return;
    watchers.trackTask(String(doc._id), doc.deploymentId, doc.task);
    watchers.notify(doc.deploymentId, toTaskEvent(doc));
  };

  // Tasks leave the queue by deletion, which carries only the id.
  const onTaskDelete = ({ _id }: { _id: unknown }) => {
    const id = String(_id);
    const tracked = watchers.untrackTask(id);
    if (tracked && watchers.has(tracked.deploymentId)) {
      watchers.notify(tracked.deploymentId, toTaskDoneEvent(id, tracked.task));
    }
  };

  let stopped = false;
  let active: Array<{ stop: () => Promise<void> }> = [];
  let reopen: NodeJS.Timeout | undefined;

  const open = () => {
    const deployments = createCollectionListener<DeploymentDocument>(NosanaCollections.DEPLOYMENTS, db);
    const jobs = createCollectionListener<JobsDocument>(NosanaCollections.JOBS, db);
    const events = createCollectionListener<EventDocument>(NosanaCollections.EVENTS, db);
    const tasks = createCollectionListener<WithId<TaskDocument>>(NosanaCollections.TASKS, db);

    deployments.addListener("insert", onDeploymentChange);
    deployments.addListener("update", onDeploymentChange, { fields: DEPLOYMENT_FIELDS });
    jobs.addListener("insert", onJobChange);
    jobs.addListener("update", onJobChange, { fields: JOB_FIELDS });
    // The event log is append-only.
    events.addListener("insert", onLogEvent);
    tasks.addListener("insert", onTaskChange);
    tasks.addListener("update", onTaskChange, { fields: TASK_FIELDS });
    tasks.addListener("delete", onTaskDelete);

    const streams = [deployments, jobs, events, tasks];
    active = streams;

    // The streams run until stop() closes them. Should any fail or end before
    // that, the API must stay up: log, close them all, and reopen them together.
    let recovering = false;
    const recover = async (error: unknown) => {
      if (stopped || recovering) return;
      recovering = true;
      log.error(error, `deployment change streams failed; reopening in ${REOPEN_DELAY_MS}ms`);
      await Promise.allSettled(streams.map((stream) => stream.stop()));
      if (!stopped) reopen = setTimeout(() => {
        open();
        watchers.closeAll();
      }, REOPEN_DELAY_MS);
    };
    streams.forEach((stream) => {
      stream.start().then(() => recover(new Error("deployment change stream ended unexpectedly")), recover);
    });
  };

  open();

  return {
    stop: async () => {
      stopped = true;
      clearTimeout(reopen);
      await Promise.allSettled(active.map((stream) => stream.stop()));
    },
  };
}
