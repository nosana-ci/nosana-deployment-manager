import { Db, WithId, ClientSession, MongoClient, Filter, Document } from "mongodb";

import { CollectionsMap, NosanaCollections } from "../definitions/collection.js";
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

type Repository<T extends Document = Document> = {
  findOne: (filter: Partial<T>) => Promise<WithId<T> | null>;
  findAll: (filter: Partial<T>) => Promise<WithId<T>[]>;
  count: (filter: Filter<T>) => Promise<number>;
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
  return {
    findOne: async (filter: Partial<T>): Promise<WithId<T> | null> => {
      return db.collection<T>(collection).findOne(filter);
    },
    findAll: async (filter: Partial<T>): Promise<WithId<T>[]> => {
      return db.collection<T>(collection).find(filter).toArray();
    },
    count: async (filter: Filter<T>): Promise<number> => {
      return db.collection<T>(collection).countDocuments(filter);
    },
    findPaginated: async (options): Promise<KeysetPaginationResult<T>> => {
      const { baseFilter, additionalFilters = [], sortField, sortOrder, limit, cursor } = options;

      // Combine base filter with additional filters
      const filters = combineFilters(
        baseFilter,
        ...additionalFilters
      ) as Filter<T>;

      return executeKeysetPagination({
        collection: db.collection<T>(collection),
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

  repositories = initRepositories<CollectionsMap>();
}


export async function withTransaction<T>(
  operations: (session: ClientSession) => Promise<T>
): Promise<T> {
  const client = dbClient;
  const session = client.startSession();

  try {
    session.startTransaction();
    const result = await operations(session);
    await session.commitTransaction();
    return result;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
}
