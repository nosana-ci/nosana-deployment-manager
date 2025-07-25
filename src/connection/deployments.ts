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
      `${createConnectionString(hostname, port, username, password)}/?${
        use_tls ? "tls=true&tlsCAFile=global-bundle.pem&" : ""
      }replicaSet=rs0`,
      { directConnection: true }
    );

    client = await mongo.connect();

    if (use_tls) {
      try {
        await client.db().admin().command({
          modifyChangeStreams: 1,
          database: "",
          collection: "",
          enable: true,
        });
      } catch (error) {
        console.error("Error enabling change streams:", error);
      }

      console.log("Change streams enabled successfully");
    }
  }

  return client.db(DB_NAME);
}
