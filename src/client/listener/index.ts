import { ChangeStream, Collection, Db, Document, ResumeToken } from "mongodb";

import { matchFields } from "./helpers/matchFields.js";
import { matchFilter } from "./helpers/matchFilter.js";
import { CollectionsNames } from "../../definitions/collection.js";

import { Collections } from "../../types/index.js";
import { AddListener, DeleteCallback, DeleteEvent, EventCallback, Filters, InsertEvent, UpdateEvent, WatchedFields } from "./types.js";

export type CollectionListener<T extends Document> = ReturnType<
  typeof createCollectionListener<T>
>;

/** Where each collection listener checkpoints its change-stream position, keyed by collection. */
export const RESUME_TOKENS_COLLECTION = "change_stream_resume_tokens";

/** How often a running listener checkpoints its position (and once more on stop). */
export const RESUME_TOKEN_SAVE_INTERVAL_MS = 10_000;

type ResumeTokenDocument = { _id: string; token: ResumeToken; updated_at: Date };

/**
 * Run one listener callback, logging its failure. Callbacks are not awaited (a
 * slow one must not hold up the stream), and a rejection must not take the
 * process down: it would come back resumed onto the same event and fail again.
 */
function runCallback(key: string, callback: () => void): void {
  const report = (error: unknown) => console.error(`[listener] a ${key} callback failed`, error);
  try {
    Promise.resolve(callback()).catch(report);
  } catch (error) {
    report(error);
  }
}

export function createCollectionListener<T extends Document>(
  key: keyof Collections,
  db: Db
) {
  if (!CollectionsNames.includes(key)) throw new Error("Invalid collection.");

  const collection: Collection<T> = db.collection(key);
  const insertCallbacks: Array<EventCallback<T>> = [];
  const updateCallbacks: Array<{
    options?: { fields?: WatchedFields<T>; filters?: Filters<T> };
    callback: EventCallback<T>;
  }> = [];
  const deleteCallbacks: Array<DeleteCallback<T>> = [];

  let stream: ChangeStream<T> | null = null;
  let stopped = false;

  // The stream's position is checkpointed on an interval and on stop, and a
  // restart resumes after it, so events written while no listener runs are
  // still delivered. At least once: events since the last checkpoint replay
  // after a crash, which the strategies' idempotent scheduling absorbs.
  const checkpoints = db.collection<ResumeTokenDocument>(RESUME_TOKENS_COLLECTION);
  let checkpointed: ResumeToken | undefined;
  let checkpointTimer: NodeJS.Timeout | undefined;

  // The driver's `resumeToken` is the position delivered so far (it also
  // advances through quiet periods); written only when it moved.
  const checkpoint = async () => {
    const token = stream?.resumeToken;
    if (token == null || token === checkpointed) return;
    checkpointed = token;
    await checkpoints
      .updateOne({ _id: key }, { $set: { token, updated_at: new Date() } }, { upsert: true })
      .catch((error) => console.error(`[listener] failed to checkpoint the ${key} change stream`, error));
  };

  const stopCheckpoints = () => {
    if (checkpointTimer) clearInterval(checkpointTimer);
    checkpointTimer = undefined;
  };

  const addListener: AddListener<T> = (...params: InsertEvent<T> | UpdateEvent<T> | DeleteEvent<T>): void => {
    switch (params[0]) {
      case "insert":
        insertCallbacks.push(params[1]);
        break;
      case "update":
        updateCallbacks.push({
          options: params[2],
          callback: params[1],
        });
        break;
      case "delete":
        deleteCallbacks.push(params[1]);
    }
  };

  const start = async (): Promise<void> => {
    if (stream || stopped) return;

    const resumeAfter = (await checkpoints.findOne({ _id: key }))?.token;
    stream = collection.watch<T>([], {
      fullDocument: "updateLookup",
      ...(resumeAfter != null && { resumeAfter }),
    });
    checkpointed = resumeAfter;
    checkpointTimer ??= setInterval(() => void checkpoint(), RESUME_TOKEN_SAVE_INTERVAL_MS);

    let delivered = false;
    try {
      for await (const event of stream) {
        delivered = true;
        switch (event.operationType) {
          case "insert":
            insertCallbacks.forEach((callback) => runCallback(key, () => callback(event.fullDocument, db)));
            break;
          case "update":
            updateCallbacks.forEach(({ options, callback }) => {
              const updatedFields = event.updateDescription.updatedFields;
              if (!updatedFields) return;

              if (options?.fields && !matchFields(updatedFields, options.fields)) {
                return;
              }

              if (
                options?.filters &&
                (!event.fullDocument || !matchFilter(event.fullDocument, options.filters))
              ) {
                return;
              }

              const { fullDocument } = event;
              if (fullDocument) {
                runCallback(key, () => callback(fullDocument, db));
              }
            });
            break;
          case "delete":
            deleteCallbacks.forEach((callback) => runCallback(key, () => callback(event.documentKey, db)));
        }
      }
    } catch (err) {
      // Swallow errors raised when the stream is closed during graceful shutdown.
      if (stopped) return;
      // A position the change stream no longer holds (DocumentDB keeps three
      // hours of history by default) fails the resume before anything is
      // delivered. Start from now rather than crash-loop on it: what happened
      // in between is lost, as it was before positions were kept.
      if (resumeAfter != null && !delivered) {
        console.error(`[listener] cannot resume the ${key} change stream, starting from now`, err);
        await checkpoints.deleteOne({ _id: key }).catch(() => {});
        await stream.close().catch(() => {});
        stream = null;
        return start();
      }
      stopCheckpoints();
      throw err;
    }
  };

  const stop = async () => {
    stopped = true;
    stopCheckpoints();
    await checkpoint();
    if (stream && !stream.closed) {
      await stream.close();
    }
  };

  return { addListener, start, stop };
}
