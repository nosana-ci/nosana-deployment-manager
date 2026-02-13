import { Db, MongoClient } from "mongodb";

import { init_db } from "./docdb/index.js";
import { getConfig } from "../config/index.js";
import { setRepository } from "../repositories/index.js";

const DB_NAME = "nosana_deployments";
export const BULK_WRITE_BATCH_SIZE = 999; // DocumentDB supports max 1000 operations per bulkWrite

function createConnectionString(
  hostname: string,
  port: string | number,
  username: string | undefined,
  password: string | undefined
): string {
  return `mongodb://${username && password ? `${username}:${encodeURIComponent(password)}@` : ""
    }${hostname}:${port}`;
}

export async function createDeploymentsConnection(): Promise<Db> {
  let db: Db | undefined = undefined;
  const {
    docdb: { hostname, port, username, password, use_tls },
  } = getConfig();
  if (!db) {
    const mongo = new MongoClient(
      `${createConnectionString(hostname, port, username, password)}/?${use_tls ? "tls=true&tlsCAFile=global-bundle.pem&" : ""
      }replicaSet=rs0`,
      { directConnection: true }
    );

    const client = await mongo.connect();
    db = client.db(DB_NAME);

    setRepository(client, db);

    await init_db(db, use_tls);
  }

  return db;
}
