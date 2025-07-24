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
      }replicaSet=rs0`,
      { directConnection: true }
    );

    client = await mongo.connect();

    await client.db().command({
      modifyChangeStreams: 1,
    });

    await mongo.db().command({
      modifyChangeStreams: 1,
    });

    const admin = mongo.db().admin();

    try {
      const res = await admin.command({
        modifyChangeStreams: 1,
        database: "deployments",
        collection: "deployments",
        enable: true,
      });

      console.log(res);
    } catch (error) {
      console.error("Error enabling change streams:", error);
    }

    const adminClient = client.db().admin();

    try {
      const res = await adminClient.command({
        modifyChangeStreams: 1,
        database: "deployments",
        collection: "deployments",
        enable: true,
      });

      console.log(res);
    } catch (error) {
      console.error("Error enabling change streams:", error);
    }

    console.log("Change streams enabled successfully");
  }

  return client.db(DB_NAME);
}
