import type { Db } from "mongodb";

import { NosanaCollections } from "../../definitions/collection.js";

import type { DeploymentDocument } from "../../types/index.js";

export function findDeployment(db: Db, jobDeployment: string) {
  return db.collection<DeploymentDocument>(NosanaCollections.DEPLOYMENTS).findOne({ id: jobDeployment });
}