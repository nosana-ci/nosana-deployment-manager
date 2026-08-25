import { ChangeStream, Collection, Db, Document } from "mongodb";

import { matchFilter } from "./helpers/matchFilter.js";
import { CollectionsNames } from "../../definitions/collection.js";

import { Collections } from "../../types/index.js";
import { AddListener, DeleteCallback, DeleteEvent, EventCallback, Filters, InsertEvent, UpdateEvent } from "./types.js";

export type CollectionListener<T extends Document> = ReturnType<
  typeof createCollectionListener<T>
>;

export function createCollectionListener<T extends Document>(
  key: keyof Collections,
  db: Db
) {
  if (!CollectionsNames.includes(key)) throw new Error("Invalid collection.");

  const collection: Collection<T> = db.collection(key);
  const insertCallbacks: Array<EventCallback<T>> = [];
  const updateCallbacks: Array<{
    options?: { fields?: (keyof T)[]; filters?: Filters<T> };
    callback: EventCallback<T>;
  }> = [];
  const deleteCallbacks: Array<DeleteCallback<T>> = [];

  let stream: ChangeStream<T> | null = null;
  let stopped = false;

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

  const start = async () => {
    if (stream || stopped) return;

    stream = collection.watch<T>([], {
      fullDocument: "updateLookup",
    });

    try {
      for await (const event of stream) {
        switch (event.operationType) {
          case "insert":
            insertCallbacks.forEach((callback) => callback(event.fullDocument, db));
            break;
          case "update":
            updateCallbacks.forEach(({ options, callback }) => {
              const updatedFields = event.updateDescription.updatedFields;
              if (!updatedFields) return;

              if (options?.fields && !options.fields.some((field) => field in updatedFields)) {
                return;
              }

              if (
                options?.filters &&
                (!event.fullDocument || !matchFilter(event.fullDocument, options.filters))
              ) {
                return;
              }

              if (event.fullDocument) {
                callback(event.fullDocument, db);
              }
            });
            break;
          case "delete":
            deleteCallbacks.forEach((callback) => callback(event.documentKey, db));
        }
      }
    } catch (err) {
      // Swallow errors raised when the stream is closed during graceful shutdown.
      if (!stopped) throw err;
    }
  };

  const stop = async () => {
    stopped = true;
    if (stream && !stream.closed) {
      await stream.close();
    }
  };

  return { addListener, start, stop };
}
