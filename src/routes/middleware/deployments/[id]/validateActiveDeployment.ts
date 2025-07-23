import { Request, NextFunction } from "express";

import { ErrorsMessages } from "../../../../errors/index.js";

import { DeploymentsResponse } from "../../../../types.js";

export async function validateActiveDeploymentMiddleware(
  req: Request<{ deployment: string }>,
  res: DeploymentsResponse,
  next: NextFunction,
): Promise<void> {
  const { deployment } = res.locals;

  if (deployment.status === "ARCHIVED") {
    res.status(500).json({ error: ErrorsMessages.deployments.ARCHIVED });
    return;
  }
  next();
}
