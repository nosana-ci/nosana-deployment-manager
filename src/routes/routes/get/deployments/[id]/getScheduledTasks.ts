import { Request } from "express";

import { DeploymentsResponse } from "../../../../../types.js";

export async function deploymentGetScheduledTasksHandler(
  req: Request<{ deployment: string }>,
  res: DeploymentsResponse
) {
  const { deployment } = req.params;
  const {
    db: { tasks },
  } = res.locals;

  const taskDocuments = await tasks
    .find({
      deploymentId: deployment,
    })
    .toArray();

  res.status(200).json(taskDocuments);
}
