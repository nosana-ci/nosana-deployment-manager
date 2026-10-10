import os from "os";
import { Db, WithId } from "mongodb";

import { getConfig } from "../../../config/index.js";
import { getRepository } from "../../../repositories/index.js";
import { runTask } from "./runTask.js";
import { claimTasks, enrichClaimedTasks } from "../claim/index.js";
import { acquireDeploymentLock, getDeploymentLocks, releaseDeploymentLock } from "../lock/index.js";
import { checkTaskWanted, isListInFlight } from "../wanted/index.js";
import {
  abandonOverCap,
  abandonInflightExhausted,
  deleteCompletedTask,
  dropUnwantedTask,
  incrementAttempt,
  parkTask,
  releaseTaskToPending,
  rescheduleInflight,
} from "../transitions/index.js";

import {
  OutstandingTasksDocument,
  TaskDocument,
  TaskFinishedReason,
  TaskRunResult,
} from "../../../types/index.js";
import { addTaskStat, removeTaskStat } from "../../../stats/index.js";

export const FETCH_INTERVAL_MS = 1_000;
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
  const tasksRepository = getRepository("tasks");
  const collection = tasksRepository.collection;
  const deployments = getRepository("deployments").collection;
  const locks = getDeploymentLocks();

  const {
    tasks_batch_size,
    task_lease_ms,
    task_max_attempts,
    task_max_inflight_retries,
    reservation_renew_ms,
  } = getConfig();

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
        ? deleteCompletedTask(tasksRepository, task._id, consumerId).catch((error) =>
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

  // API-path in-flight (IN_PROGRESS / no definitive response): reschedule after
  // the CM's backoff WITHOUT counting it as a crash-loop attempt, then drop local
  // state. Re-issues the same idempotency key on the next claim (CM de-dupes).
  const rescheduleInflightTask = async (task: OutstandingTasksDocument, result: TaskRunResult) => {
    await rescheduleInflight(collection, task._id, consumerId, result.retryAfterMs);
    // teardown drops local state + releases the lock (no delete). The "TIMEOUT"
    // metric bucket is reused for "left without completing, comes back" — the
    // crash-loop accounting, which is what actually matters, is kept separate via
    // `inflight_retries` in rescheduleInflight.
    await teardown(task, result.successCount, "TIMEOUT", false);
  };

  // LIST waiting on a host-manager reservation request: park it until the
  // request needs renewing (the webhook makes it due sooner), counting neither an
  // attempt nor an in-flight retry, then drop local state.
  const parkWaitingTask = async (task: OutstandingTasksDocument, result: TaskRunResult) => {
    await parkTask(collection, task._id, consumerId, reservation_renew_ms);
    await teardown(task, result.successCount, "TIMEOUT", false);
  };

  const dispatch = (task: OutstandingTasksDocument) => {
    const controller = new AbortController();
    inflight.set(task._id.toHexString(), { controller, task });
    addTaskStat(task._id, task.task);

    const leaseTimer = setTimeout(() => controller.abort(), task_lease_ms);

    void runTask(db, task, controller.signal)
      .then((result) => {
        if (result.outcome === "ABORTED") return abandonInflight(task, result.successCount);
        if (result.outcome === "RETRY") return rescheduleInflightTask(task, result);
        if (result.outcome === "PARKED") return parkWaitingTask(task, result);
        return finishTerminal(task, result);
      })
      .catch(async (error) => {
        console.error("[tasks] task run errored", error);
        await abandonInflight(task, 0);
      })
      .finally(() => clearTimeout(leaseTimer));
  };

  // A failed cycle must never reject: both call sites are fire-and-forget, so a
  // rejection would crash the process. Claimed-but-undispatched tasks wait out
  // their lease and are reclaimed.
  const fetchNewTasks = async () => {
    try {
      await fetchNewTasksCycle();
    } catch (error) {
      console.error("[tasks] fetch cycle failed", error);
    }
  };

  const fetchNewTasksCycle = async () => {
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
      const overCap = task.attempts >= task_max_attempts;
      // Separate, more generous bound on legitimate in-flight retries / retryable
      // task errors (which don't touch `attempts`): exhausting a *finite* cap
      // abandons the deployment to ERROR. `0` disables the cap — retry forever at
      // the capped cooldown.
      const exhausted =
        task_max_inflight_retries > 0 && (task.inflight_retries ?? 0) >= task_max_inflight_retries;
      if (overCap || exhausted) {
        // ERROR means a wanted task failed. One the deployment no longer wants
        // (a drain included) says nothing about it: dropped, status untouched.
        if (!(await checkTaskWanted(task))) await dropUnwantedTask(tasksRepository, task, consumerId);
        else if (overCap) await abandonOverCap(tasksRepository, deployments, task);
        else await abandonInflightExhausted(tasksRepository, deployments, task);
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
      // `attempts` means exactly "real dispatches". The write is fenced on our
      // claim: a task deleted or reclaimed since is not ours to run.
      if (!(await incrementAttempt(collection, task._id, consumerId))) {
        await releaseDeploymentLock(locks, task.deploymentId, consumerId).catch(() => {});
        continue;
      }

      // Judged still wanted against the deployment as it is now, with the lock
      // held. A LIST in flight runs anyway, to record what landed: it re-checks
      // before signing anything new, and drains instead.
      if (!isListInFlight(task) && !(await checkTaskWanted(task))) {
        await dropUnwantedTask(tasksRepository, task, consumerId);
        await releaseDeploymentLock(locks, task.deploymentId, consumerId).catch(() => {});
        continue;
      }

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
