import type {DeploymentDocument} from "../../../types";
import {NosanaCollections} from "../../../definitions/collection.js";
import {Db} from "mongodb";

export const UPDATE_EVENT_TYPE = "update";
export const STATE_FIELD = "state";

export function findDeployment(db: Db, jobDeployment: string) {
  return db.collection<DeploymentDocument>(NosanaCollections.DEPLOYMENTS).findOne({deployment: jobDeployment});
}