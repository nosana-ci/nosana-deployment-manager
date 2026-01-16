import type { RouteHandler } from "fastify";

import type {
  GetDeploymentScheduledTasksError,
  GetDeploymentScheduledTasksSuccess,
} from "../../../../schema/get/deployments/[id]/getScheduledTasks.schema.js";
import type { HeadersSchema } from "../../../../schema/index.schema.js";

export const deploymentGetScheduledTasksHandler: RouteHandler<{
  Params: { deployment: string };
  Headers: HeadersSchema;
  Reply: GetDeploymentScheduledTasksSuccess | GetDeploymentScheduledTasksError;
}> = async (req, res) => {
  const { deployment } = req.params;
  const {
    db: { tasks },
  } = res.locals;

  try {
    const taskDocuments = await tasks
      .find({
        deploymentId: deployment,
      }).sort({ created_at: -1 })
      .toArray();

    res.status(200);
    return taskDocuments.map((task) => (
      { job: undefined, limit: undefined, active_revision: undefined, ...task }
    ));
  } catch (error) {
    req.log.error(error, "Failed to get scheduled tasks for deployment");
    res.status(500).send({
      error: "Failed to get scheduled tasks",
    });
  }
};
