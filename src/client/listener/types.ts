import { Db } from "mongodb";

export type FilterOperators<T> =
  | { $eq: T }
  | { $ne: T }
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
  "UPDATE": "update"
} as const;
export type EventType = typeof OnEvent[keyof typeof OnEvent];

export type EventCallback<T> = (data: T, db: Db) => void;
export type InsertEvent<T> = [typeof OnEvent.INSERT, EventCallback<T>];
export type UpdateEvent<T> = [typeof OnEvent.UPDATE, EventCallback<T>, { fields?: (keyof T)[]; filters?: Filters<T> }];

export type StrategyListener<T> = InsertEvent<T> | UpdateEvent<T>