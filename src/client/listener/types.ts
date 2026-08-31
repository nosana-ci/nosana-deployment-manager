import { Db, InferIdType } from "mongodb";

export type FilterOperators<T> =
  | { $eq: T }
  | { $ne: T }
  | { $in: T[] }
  | { $nin: T[] }
  | (T extends number ? { $gt?: T; $gte?: T; $lt?: T; $lte?: T } : {})
  | (T extends Date ? { $gt?: T; $lt?: T } : {});

type FieldFilter<T> = {
  [K in keyof T]?: FilterOperators<T[K]>;
};

export type Filters<T> =
  | FieldFilter<T>
  | { $and: Filters<T>[] }
  | { $or: Filters<T>[] }
  | { $not: Filters<T> };

export const OnEvent = {
  "INSERT": "insert",
  "UPDATE": "update",
  "DELETE": "delete"
} as const;
export type EventType = typeof OnEvent[keyof typeof OnEvent];

export type EventCallback<T> = (data: T, db: Db) => void;
export type InsertEvent<T> = [typeof OnEvent.INSERT, EventCallback<T>];
/**
 * The document fields an update listener reacts to. `Extract<…, string>` because
 * these are matched against change-stream field paths, which are always strings —
 * a `symbol` or numeric key could never appear there.
 */
export type WatchedFields<T> = Extract<keyof T, string>[];

export type UpdateEvent<T> = [typeof OnEvent.UPDATE, EventCallback<T>, { fields?: WatchedFields<T>; filters?: Filters<T> }];
/** A delete carries no document, only its key. */
export type DeleteCallback<T> = (documentKey: { _id: InferIdType<T> }, db: Db) => void;
export type DeleteEvent<T> = [typeof OnEvent.DELETE, DeleteCallback<T>];

/** One overload per event, so an inline callback is typed for the event it handles. */
export type AddListener<T> = {
  (...params: InsertEvent<T>): void;
  (...params: UpdateEvent<T>): void;
  (...params: DeleteEvent<T>): void;
};

export type StrategyListener<T> = InsertEvent<T> | UpdateEvent<T>