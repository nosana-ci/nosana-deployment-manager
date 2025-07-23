import { Db, MongoClient } from "mongodb";

import { getConfig } from "../config/index.js";

const DB_NAME = "nosana_deployments";

function createConnectionString(
  hostname: string,
  port: string | number,
  username: string | undefined,
  password: string | undefined,
): string {
  return `mongodb://${
    username && password ? `${username}:${password}@` : ""
  }${hostname}:${port}`;
}

export async function DeploymentsConnection(): Promise<Db> {
  let client: MongoClient | undefined = undefined;
  const {
    docdb: { hostname, port, username, password },
  } = getConfig();

  if (!client) {
    const mongo = new MongoClient(
      `${createConnectionString(
        hostname,
        port,
        username,
        password,
      )}/deployments?replicaSet=rs0`,
    );
    // TODO: Handle connection errors and retries
    client = await mongo.connect();
  }

  return client.db(DB_NAME);
}
