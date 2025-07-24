import { Db, MongoClient } from "mongodb";

import { getConfig } from "../config/index.js";

const DB_NAME = "nosana_deployments";

function createConnectionString(
  hostname: string,
  port: string | number,
  username: string | undefined,
  password: string | undefined
): string {
  return `mongodb://${
    username && password ? `${username}:${encodeURIComponent(password)}@` : ""
  }${hostname}:${port}`;
}

export async function DeploymentsConnection(): Promise<Db> {
  let client: MongoClient | undefined = undefined;
  const {
    docdb: { hostname, port, username, password, use_tls },
  } = getConfig();
  if (!client) {
    const mongo = new MongoClient(
      `${createConnectionString(
        hostname,
        port,
        username,
        password
      )}/deployments?${
        use_tls ? "tls=true&tlsCAFile=global-bundle.pem&" : ""
      }replicaSet=rs0`
    );

    try {
      const admin = mongo.db().admin();

      // Enable change streams for the entire cluster
      await admin.command({
        modifyChangeStreams: 1,
        enable: true,
      });

      console.log("Change streams enabled successfully");
    } catch (error) {
      console.error("Error enabling change streams:", error);
    }

    // TODO: Handle connection errors and retries
    client = await mongo.connect();
  }

  return client.db(DB_NAME);
}
