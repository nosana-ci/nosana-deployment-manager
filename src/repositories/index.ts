import { Collection, Db, WithId, ClientSession, MongoClient, Filter, FindOptions, MatchKeysAndValues, OptionalUnlessRequiredId, Document, DeleteResult } from "mongodb";

import { cancelReservationRequest } from "../client/hostManager/index.js";
import { CollectionsMap, NosanaCollections } from "../definitions/collection.js";
import { TaskType, type TaskDocument } from "../types/index.js";
import {
  executeKeysetPagination,
  combineFilters,
  buildMultiValueFilter as buildMultiValueFilterUntyped,
  buildSingleValueFilter as buildSingleValueFilterUntyped,
  buildDateRangeFilter as buildDateRangeFilterUntyped,
  buildPartialMatchFilter as buildPartialMatchFilterUntyped,
  type KeysetPaginationResult,
  type SortOrder,
  type PageSize
} from "./filters/index.js";

/**
 * Strict filter that only allows actual document fields (not query operators)
 */
type StrictFilter<T extends Document> = {
  [K in keyof T]?: T[K] | Filter<T[K]>;
};

/**
 * Utility type that converts all Date fields to string (for serialization)
 */
export type SerializedDates<T> = {
  [K in keyof T]: T[K] extends Date
  ? string
  : T[K] extends Date | undefined
  ? string | undefined
  : T[K];
};

/**
 * Serializes Date fields to ISO strings
 */
export function serializeDates<T extends Document>(doc: T): SerializedDates<T>;
export function serializeDates<T extends Document>(doc: T[]): SerializedDates<T>[];
export function serializeDates<T extends Document>(doc: T | T[]): SerializedDates<T> | SerializedDates<T>[] {
  if (Array.isArray(doc)) {
    return doc.map((item) => serializeDates(item)) as SerializedDates<T>[];
  }

  const serialized = { ...doc } as Record<string, unknown>;
  for (const key in serialized) {
    if (serialized[key] instanceof Date) {
      serialized[key] = (serialized[key] as Date).toISOString();
    }
  }
  return serialized as SerializedDates<T>;
}

/**
 * Typed filter builders for a specific document type
 * Uses Extract to ensure only string keys are allowed
 */
export type FilterBuilders<T extends Document> = {
  buildMultiValueFilter: <K extends Extract<keyof T, string>>(field: K, value: string | undefined) => Record<string, unknown> | undefined;
  buildSingleValueFilter: <K extends Extract<keyof T, string>>(field: K, value: string | number | undefined) => Record<string, unknown> | undefined;
  buildDateRangeFilter: <K extends Extract<keyof T, string>>(field: K, after?: string, before?: string) => Record<string, unknown> | undefined;
  buildPartialMatchFilter: <K extends Extract<keyof T, string>>(fields: K[], searchTerm: string | undefined) => Record<string, unknown> | undefined;
};

export type WriteOptions = { session?: ClientSession };

export type Repository<T extends Document = Document> = {
  /**
   * The raw MongoDB collection. Escape hatch for custom/atomic operations not
   * covered by the methods below (e.g. `$inc`/`$push`/`arrayFilters` updates,
   * `findOneAndUpdate` with sort, aggregation). Obtained via the typed
   * collection key, so the collection name can't be mistyped.
   */
  collection: Collection<T>;
  findOne: (filter: Filter<T>, options?: FindOptions) => Promise<WithId<T> | null>;
  findAll: (filter: Filter<T>, options?: FindOptions) => Promise<WithId<T>[]>;
  count: (filter: Filter<T>) => Promise<number>;
  create: (doc: OptionalUnlessRequiredId<T>, options?: WriteOptions) => Promise<WithId<T>>;
  update: (filter: Filter<T>, update: Partial<T>, options?: WriteOptions) => Promise<WithId<T> | null>;
  createOrUpdate: (filter: Filter<T>, update: Partial<T>, options?: WriteOptions) => Promise<WithId<T> | null>;
  /** Deletes every document matching `filter`. */
  delete: (filter: Filter<T>, options?: WriteOptions) => Promise<DeleteResult>;
  findPaginated: (options: {
    baseFilter?: StrictFilter<T>;
    additionalFilters?: (Record<string, unknown> | undefined)[];
    sortField: Extract<keyof T, string>;
    sortOrder: SortOrder;
    limit: PageSize;
    cursor?: string;
  }) => Promise<KeysetPaginationResult<T>>;
  filters: FilterBuilders<T>;
  serializeDates: {
    (doc: T): SerializedDates<T>;
    (doc: T[]): SerializedDates<T>[];
  };
}

function createRepository<T extends Document = Document>(
  db: Db,
  collection: string
): Repository<T> {
  const col = db.collection<T>(collection);
  return {
    collection: col,
    findOne: async (filter: Filter<T>, options?: FindOptions): Promise<WithId<T> | null> => {
      return col.findOne(filter, options);
    },
    findAll: async (filter: Filter<T>, options?: FindOptions): Promise<WithId<T>[]> => {
      return col.find(filter, options).toArray();
    },
    count: async (filter: Filter<T>): Promise<number> => {
      return col.countDocuments(filter);
    },
    create: async (doc: OptionalUnlessRequiredId<T>, options?: WriteOptions): Promise<WithId<T>> => {
      const result = await col.insertOne(doc, options);
      return { ...doc, _id: result.insertedId } as WithId<T>;
    },
    update: async (filter: Filter<T>, update: Partial<T>, options?: WriteOptions): Promise<WithId<T> | null> => {
      return col.findOneAndUpdate(
        filter,
        { $set: update as MatchKeysAndValues<T> },
        { ...options, returnDocument: "after" },
      );
    },
    createOrUpdate: async (filter: Filter<T>, update: Partial<T>, options?: WriteOptions): Promise<WithId<T> | null> => {
      return col.findOneAndUpdate(
        filter,
        { $set: update as MatchKeysAndValues<T> },
        { ...options, upsert: true, returnDocument: "after" },
      );
    },
    delete: async (filter: Filter<T>, options?: WriteOptions): Promise<DeleteResult> => {
      return col.deleteMany(filter, options);
    },
    findPaginated: async (options): Promise<KeysetPaginationResult<T>> => {
      const { baseFilter, additionalFilters = [], sortField, sortOrder, limit, cursor } = options;

      // Combine base filter with additional filters
      const filters = combineFilters(
        baseFilter,
        ...additionalFilters
      ) as Filter<T>;

      return executeKeysetPagination({
        collection: col,
        filters,
        sortField,
        sortOrder,
        limit,
        cursor,
      });
    },
    filters: {
      buildMultiValueFilter: <K extends Extract<keyof T, string>>(field: K, value: string | undefined) =>
        buildMultiValueFilterUntyped<T>(field, value),
      buildSingleValueFilter: <K extends Extract<keyof T, string>>(field: K, value: string | number | undefined) =>
        buildSingleValueFilterUntyped<T>(field, value),
      buildDateRangeFilter: <K extends Extract<keyof T, string>>(field: K, after?: string, before?: string) =>
        buildDateRangeFilterUntyped<T>(field, after, before),
      buildPartialMatchFilter: <K extends Extract<keyof T, string>>(fields: K[], searchTerm: string | undefined) =>
        buildPartialMatchFilterUntyped<T>(fields, searchTerm),
    },
    serializeDates: serializeDates as Repository<T>['serializeDates'],
  };
}

/**
 * The tasks repository's `delete` also releases what host-manager holds for the
 * LIST tasks it deletes. Their reservation request is keyed by the task id, so
 * however a task goes (completed, swept by a stop, a banned owner, the attempt
 * caps) its request is cancelled and its unassigned holds freed now rather than
 * at expiry. Best effort: the cancels are not awaited, and a failure is logged.
 */
function createTasksRepository(db: Db): Repository<TaskDocument> {
  const repository = createRepository<TaskDocument>(db, NosanaCollections.TASKS);
  return {
    ...repository,
    delete: async (filter, options) => {
      // A filter naming another task type cannot match a LIST: nothing to release.
      const mayMatchList = typeof filter.task !== "string" || filter.task === TaskType.LIST;
      const held = mayMatchList
        ? await repository.collection
            .find(
              {
                $and: [
                  filter,
                  {
                    task: TaskType.LIST,
                    $or: [{ reservation_request: { $exists: true } }, { reservation: { $exists: true } }],
                  },
                ],
              },
              { projection: { _id: 1 }, session: options?.session }
            )
            .toArray()
        : [];

      const result = await repository.delete(filter, options);
      for (const { _id } of held) {
        const key = _id.toHexString();
        cancelReservationRequest(key).catch((error: unknown) =>
          console.error(`[reservations] failed to cancel the request of deleted task ${key}`, error)
        );
      }
      return result;
    },
  };
}

let dbClient: MongoClient;
let repositories: {
  [K in keyof CollectionsMap]: Repository<CollectionsMap[K]>
};

export function getRepository<K extends keyof CollectionsMap>(
  collection: K
): Repository<CollectionsMap[K]> {
  if (!repositories || !repositories[collection]) {
    throw new Error(`${collection} repository not initialized`);
  }
  return repositories[collection];
}

export function setRepository(client: MongoClient, db: Db): void {
  dbClient = client;
  const initRepositories = <T extends Record<string, Document>>() => {
    const repos = {} as { [K in keyof T]: Repository<T[K]> };

    for (const key of Object.values(NosanaCollections)) {
      repos[key as keyof T] = createRepository<Document>(db, key) as unknown as Repository<T[keyof T]>;
    }

    return repos;
  };

  repositories = { ...initRepositories<CollectionsMap>(), tasks: createTasksRepository(db) };
}


export async function withTransaction<T>(
  operations: (session: ClientSession) => Promise<T>
): Promise<T> {
  const client = dbClient;
  const session = client.startSession();

  try {
    // The driver retries transient write conflicts and ambiguous commit acknowledgements.
    return await session.withTransaction(() => operations(session));
  } finally {
    await session.endSession();
  }
}

function lazyRepository<K extends keyof CollectionsMap>(
  collection: K
): Repository<CollectionsMap[K]> {
  return new Proxy({} as Repository<CollectionsMap[K]>, {
    get(_target, prop) {
      const repo = getRepository(collection);
      return Reflect.get(repo, prop);
    },
  });
}

export const DeploymentsRepository = lazyRepository(NosanaCollections.DEPLOYMENTS);
export const EventsRepository = lazyRepository(NosanaCollections.EVENTS);
export const VaultsRepository = lazyRepository(NosanaCollections.VAULTS);
export const JobsRepository = lazyRepository(NosanaCollections.JOBS);
export const TasksRepository = lazyRepository(NosanaCollections.TASKS);
export const RevisionsRepository = lazyRepository(NosanaCollections.REVISIONS);
export const ResultsRepository = lazyRepository(NosanaCollections.RESULTS);
export const FrpsEndpointStatusRepository = lazyRepository(NosanaCollections.FRPS_ENDPOINT_STATUS);