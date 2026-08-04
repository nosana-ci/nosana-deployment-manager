import { FrpsStreamCursorRepository } from "../../repositories/index.js";
import { getFrpsMetrics } from "../../metrics/frps.js";

const CURSOR_ID = "frps";
const LOG = "[FRPS cursor]";

export type CursorWriter = {
  /** Note that an event with this id has been processed. */
  record: (lastEventId: string) => void;
  /** Flush the latest id and stop; call on shutdown. */
  stop: () => Promise<void>;
};

/** Reads the persisted resume point, or undefined if we've never stored one. */
export async function readCursor(): Promise<string | undefined> {
  const cursor = await FrpsStreamCursorRepository.findOne({ _id: CURSOR_ID });
  return cursor?.last_event_id;
}

/**
 * Persists the stream resume point, throttled to at most one write per
 * `throttleMs`. Lagging behind the live stream is safe: on restart we replay
 * from the last stored id, and every event handler is idempotent, so re-applying
 * a few already-processed events is a no-op.
 */
export function createCursorWriter(throttleMs: number): CursorWriter {
  let latest: string | null = null;
  let persisted: string | null = null;
  let timer: NodeJS.Timeout | null = null;

  const flush = async () => {
    timer = null;
    if (latest === null || latest === persisted) return;
    const id = latest;
    try {
      await FrpsStreamCursorRepository.createOrUpdate(
        { _id: CURSOR_ID },
        { last_event_id: id, updated_at: new Date() },
      );
      persisted = id;
      getFrpsMetrics()?.recordCursorPersisted();
    } catch (error) {
      console.error(`${LOG} failed to persist cursor`, error);
    }
  };

  return {
    record: (lastEventId) => {
      if (!lastEventId) return;
      latest = lastEventId;
      if (!timer) {
        timer = setTimeout(() => void flush(), throttleMs);
        timer.unref?.();
      }
    },
    stop: async () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await flush();
    },
  };
}
