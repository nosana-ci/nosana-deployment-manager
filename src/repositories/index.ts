import { Db, WithId, ClientSession, MongoClient } from "mongodb";

import { CollectionsMap, NosanaCollections } from "../definitions/collection.js";

type Repository<T> = {
  findOne: (filter: Partial<T>) => Promise<WithId<T> | null>;
  findAll: (filter: Partial<T>) => Promise<WithId<T>[]>;
}

function createRepository<T extends Record<string, unknown>>(
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
  const initRepositories = <T extends Record<string, Record<string, unknown>>>() => {
    const repos = {} as { [K in keyof T]: Repository<T[K]> };

    for (const key of Object.values(NosanaCollections)) {
      repos[key as keyof T] = createRepository<Record<string, unknown>>(db, key) as unknown as Repository<T[keyof T]>;
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
