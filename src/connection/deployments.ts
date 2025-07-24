import { Db, MongoClient } from "mongodb";

import { getConfig } from "../config/index.js";
import { CollectionsNames } from "../definitions/collection.js";

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

    client = await mongo.connect();

    try {
      const admin = mongo.db().admin();

      for (const collection of CollectionsNames) {
        try {
          await client.db("deployments").createCollection(collection);
          await admin.command({
            modifyChangeStreams: 1,
            database: "deployments",
            collection,
            enable: true,
          });
        } catch (error) {
          console.error(error);
        }
      }
      console.log("Change streams enabled successfully");
    } catch (error) {
      console.error("Error enabling change streams:", error);
    }
  }

  return client.db(DB_NAME);
}
