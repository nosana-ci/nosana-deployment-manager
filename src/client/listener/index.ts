import { Collection, Db, Document } from "mongodb";

import { matchFilter } from "./helpers/matchFilter.js";
import { CollectionsNames } from "../../definitions/collection.js";

import { Collections } from "../../types/index.js";
import { EventCallback, Filters, InsertEvent, UpdateEvent } from "./types.js";

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

  const addListener = (...params: InsertEvent<T> | UpdateEvent<T>): void => {
    const [eventType, callback, options] = params;
    switch (eventType) {
      case "insert":
        insertCallbacks.push(callback);
        break;
      case "update":
        updateCallbacks.push({
          options,
          callback: callback,
        });
    }
  };

  const start = async () => {
    const stream = collection.watch<T>([], {
      fullDocument: "updateLookup",
    });

    for await (const event of stream) {
      switch (event.operationType) {
        case "insert":
          insertCallbacks.forEach((callback) => callback(event.fullDocument));
          break;
        case "update":
          updateCallbacks.forEach(({ options, callback }) => {
            const updatedFields = event.updateDescription.updatedFields;
            if (!updatedFields) return;

            if (options?.fields && !options.fields.some((field) => field in updatedFields)) {
              return;
            }

            if (options?.filters && !matchFilter(updatedFields, options.filters)) {
              return;
            }

            if (event.fullDocument) {
              callback(event.fullDocument);
            }
          });
      }
    }
  };

  return { addListener, start };
}
