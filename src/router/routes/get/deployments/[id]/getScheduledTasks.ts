import type { RouteHandler } from "fastify";

import type {
  GetDeploymentScheduledTasksError,
  GetDeploymentScheduledTasksSuccess,
} from "../../../../schema/get/deployments/[id]/getScheduledTasks.schema.js";
import type { HeadersSchema } from "../../../../schema/index.schema.js";
import type { PaginationQuery } from "../../../../schema/components/pagination.schema.js";
import type { TasksFilter } from "../../../../schema/components/filters.schema.js";
import { NosanaCollections } from "../../../../../definitions/collection.js";
import { getRepository } from "../../../../../repositories/index.js";

export const deploymentGetScheduledTasksHandler: RouteHandler<{
  Params: { deployment: string };
  Headers: HeadersSchema;
  Querystring: PaginationQuery & TasksFilter;
  Reply: GetDeploymentScheduledTasksSuccess | GetDeploymentScheduledTasksError;
}> = async (req, res) => {
  const { deployment } = req.params;
  const { task, due_after, due_before, sort_order = 'desc', limit = 10, cursor } = req.query;

  const {
    findPaginated,
    filters: { buildMultiValueFilter, buildDateRangeFilter }
  } = getRepository(NosanaCollections.TASKS);

  try {
    const { items, pagination } = await findPaginated({
      baseFilter: { deploymentId: deployment },
      additionalFilters: [
        buildMultiValueFilter('task', task),
        buildDateRangeFilter('due_at', due_after, due_before)
      ],
      sortField: 'created_at',
      sortOrder: sort_order,
      limit: parseInt(String(limit)),
      cursor,
    });

    res.status(200);
    return {
      tasks: items.map((task) => ({
        task: task.task,
        deploymentId: task.deploymentId,
        tx: task.tx ?? undefined,
        job: task.job,
        limit: task.limit,
        active_revision: task.active_revision,
        due_at: task.due_at.toISOString(),
        created_at: task.created_at.toISOString(),
      })),
      pagination,
    };
  } catch (error) {
    req.log.error(error, "Failed to get scheduled tasks for deployment");
    res.status(500).send({
      error: "Failed to get scheduled tasks",
    });
  }
};
