import { Db, MongoClient } from "mongodb";

import { init_db } from "./docdb/index.js";
import { getConfig } from "../config/index.js";
import { setRepository } from "../repositories/index.js";

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
    docdb: { hostname, port, username, password, use_tls, dbname },
  } = getConfig();
  if (!db) {
    const connectionString = use_tls
      ? `${createConnectionString(hostname, port, username, password)}/?tls=true&tlsCAFile=global-bundle.pem&replicaSet=rs0&authMechanism=SCRAM-SHA-1`
      : `${createConnectionString(hostname, port, username, password)}/?directConnection=true`;

    const mongo = new MongoClient(connectionString);

    const client = await mongo.connect();
    db = client.db(dbname);

    setRepository(client, db);

    await init_db(db, use_tls);
  }

  return db;
}
