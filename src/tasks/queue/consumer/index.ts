import os from "os";
import { Db, WithId } from "mongodb";

import { getConfig } from "../../../config/index.js";
import { getRepository } from "../../../repositories/index.js";
import { runTask } from "./runTask.js";
import { claimTasks, enrichClaimedTasks } from "../claim/index.js";
import { acquireDeploymentLock, getDeploymentLocks, releaseDeploymentLock } from "../lock/index.js";
import {
  abandonOverCap,
  deleteCompletedTask,
  incrementAttempt,
  releaseTaskToPending,
} from "../transitions/index.js";

import {
  OutstandingTasksDocument,
  TaskDocument,
  TaskFinishedReason,
  TaskRunResult,
} from "../../../types/index.js";
import { addTaskStat, removeTaskStat } from "../../../stats/index.js";

export const FETCH_INTERVAL_MS = 5_000;
export const TASK_DRAIN_POLL_INTERVAL_MS = 500;

export type TaskCollectionListenerHandle = {
  stop: () => Promise<void>;
};

type InflightTask = {
  controller: AbortController;
  task: OutstandingTasksDocument;
};

export function startTaskCollectionListener(db: Db): TaskCollectionListenerHandle {
  // Keyed by the task _id hex string (NOT the ObjectId object) so lookups work
  // across the fresh ObjectId instances returned by each claim/enrich query.
  const inflight = new Map<string, InflightTask>();
  const collection = getRepository("tasks").collection;
  const deployments = getRepository("deployments").collection;
  const locks = getDeploymentLocks();

  const { tasks_batch_size, task_lease_ms, task_max_attempts } = getConfig();

  const consumerId = `${os.hostname()}:${process.pid}`;
  let fetchInterval: NodeJS.Timeout | undefined;
  let stopped = false;

  // Release per-task state: optionally delete the task doc (fenced on our lease
  // so a consumer that lost the lease never deletes another's work), release the
  // deployment lock (independent — run both concurrently), drop local state.
  const teardown = async (
    task: OutstandingTasksDocument,
    successCount: number,
    reason: TaskFinishedReason,
    deleteDoc: boolean
  ) => {
    await Promise.all([
      deleteDoc
        ? deleteCompletedTask(collection, task._id, consumerId).catch((error) =>
            console.error("[tasks] failed to delete completed task", error)
          )
        : Promise.resolve(),
      releaseDeploymentLock(locks, task.deploymentId, consumerId).catch(() => {}),
    ]);
    inflight.delete(task._id.toHexString());
    removeTaskStat(task._id, successCount, reason);
  };

  // Terminal completion: delete the task and drop state.
  const finishTerminal = (task: OutstandingTasksDocument, result: TaskRunResult) =>
    teardown(task, result.successCount, result.outcome === "FAILED" ? "FAILED" : "COMPLETED", true);

  // Lease killed mid-run: leave the task in Mongo (lapsed lease) for reclaim.
  const abandonInflight = (task: OutstandingTasksDocument, successCount: number) =>
    teardown(task, successCount, "TIMEOUT", false);

  const dispatch = (task: OutstandingTasksDocument) => {
    const controller = new AbortController();
    inflight.set(task._id.toHexString(), { controller, task });
    addTaskStat(task._id, task.task);

    const leaseTimer = setTimeout(() => controller.abort(), task_lease_ms);

    void runTask(db, task, controller.signal)
      .then((result) =>
        result.outcome === "ABORTED"
          ? abandonInflight(task, result.successCount)
          : finishTerminal(task, result)
      )
      .catch(async (error) => {
        console.error("[tasks] task run errored", error);
        await abandonInflight(task, 0);
      })
      .finally(() => clearTimeout(leaseTimer));
  };

  const fetchNewTasks = async () => {
    if (stopped) return;

    const capacity = tasks_batch_size - inflight.size;
    if (capacity <= 0) return;

    const claimed = await claimTasks(collection, consumerId, capacity, task_lease_ms);
    if (claimed.length === 0) return;

    const survivors: WithId<TaskDocument>[] = [];
    for (const task of claimed) {
      if (inflight.has(task._id.toHexString())) continue;
      // `attempts` is the count of prior real dispatches (bumped post-lock), so
      // the cap is `>=`: a task that has already run `task_max_attempts` times is
      // abandoned rather than dispatched again.
      if (task.attempts >= task_max_attempts) {
        await abandonOverCap(collection, deployments, task);
        continue;
      }
      survivors.push(task);
    }

    const enriched = await enrichClaimedTasks(
      collection,
      survivors.map((task) => task._id)
    );

    for (const task of enriched) {
      if (stopped) break;

      const acquired = await acquireDeploymentLock(
        locks,
        task.deploymentId,
        consumerId,
        task_lease_ms
      );
      if (!acquired) {
        await releaseTaskToPending(collection, task._id);
        continue;
      }

      // Count the attempt only now that the lock is held and we will actually
      // run it, so lock contention never burns an attempt (no undo needed) and
      // `attempts` means exactly "real dispatches".
      await incrementAttempt(collection, task._id, consumerId);

      dispatch(task);
    }
  };

  fetchNewTasks().then(() => {
    fetchInterval = setInterval(() => void fetchNewTasks(), FETCH_INTERVAL_MS);
  });

  return {
    stop: async () => {
      stopped = true;
      if (fetchInterval) {
        clearInterval(fetchInterval);
        fetchInterval = undefined;
      }

      // Abort in-flight work; each run resolves ABORTED and abandons its task
      // (left in Mongo with a lapsed lease) for another consumer to reclaim.
      for (const { controller } of inflight.values()) {
        controller.abort();
      }

      const deadline = Date.now() + task_lease_ms;
      while (inflight.size > 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, TASK_DRAIN_POLL_INTERVAL_MS));
      }
    },
  };
}
