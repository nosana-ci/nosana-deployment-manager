/**
 * Public surface of the tasks module.
 *
 * Internals are grouped by concern:
 *   - `queue/`     — the consumer: claim → cap → lock → dispatch (and, in time,
 *                    retry / cooldown / dead-letter policy).
 *   - `execution/` — on-chain work: broadcast, confirm and recover transactions.
 *   - `task/`      — per-type signers, runners and event handlers.
 *
 * The producer side (`scheduleTask`, `updateScheduledTasks`) and `utils` are
 * imported directly from their own paths by the strategies.
 */
export {
  startTaskCollectionListener,
  type TaskCollectionListenerHandle,
} from "./queue/consumer/index.js";
