import { Db } from "mongodb";
import express from "express";

import { authMiddleware } from "./middleware/index.js";
import { CollectionsNames } from "../definitions/collection.js";
import { setupDeploymentsRoutes, setupVaultRoutes } from "./setup/index.js";

import { Collections } from "../types.js";

export function startDeploymentManagerApi(db: Db) {
  const app = express();

  const collections = CollectionsNames.reduce((collections, name) => {
    // @ts-ignore
    collections[name] = db.collection(name);
    return collections;
  }, {} as Collections);

  app.use((_, res, next) => {
    res.locals.db = collections;
    next();
  });

  app.use(express.json());
  app.use(authMiddleware);
  setupDeploymentsRoutes(app);
  setupVaultRoutes(app);

  app.listen(3000, () => {
    console.log("Server is running on port 3000");
  });
}
