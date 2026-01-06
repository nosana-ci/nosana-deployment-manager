import {Db, MongoClient} from "mongodb";
import {createConnectionString, DB_NAME} from "../../../src/connection/index.js";

export async function createTestDbClient(): Promise<Db> {
    const mongo = new MongoClient(
      `${createConnectionString('localhost', 27017, '', '')}/?replicaSet=rs0`,
      { directConnection: true }
    );

    console.log("Connecting to test database...");
    const client = await mongo.connect();
    return client.db(DB_NAME);
}