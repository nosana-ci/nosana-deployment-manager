import type { RouteHandler } from "fastify";

import { getRepository } from "../../../../repositories/index.js";
import { NosanaCollections } from "../../../../definitions/collection.js";

import { DeploymentDocumentFields, JobState } from "../../../../types/index.js";

import type {
  DeploymentsHandlerSuccess,
  DeploymentsHandlerError,
} from "../../../schema/get/deployments/list.schema.js";
import type { HeadersSchema } from "../../../schema/index.schema.js";
import type { PaginationQuery } from "../../../schema/components/pagination.schema.js";
import type { DeploymentsFilter } from "../../../schema/components/filters.schema.js";

export const deploymentsHandler: RouteHandler<{
  Headers: HeadersSchema;
  Querystring: PaginationQuery & DeploymentsFilter;
  Reply: DeploymentsHandlerSuccess | DeploymentsHandlerError;
}> = async (req, res) => {
  const userId = req.headers["x-user-id"];
  const { search, status, strategy, id, name, vault, created_after, created_before, sort_order = 'desc', limit = 10, cursor } = req.query;

  const {
    findPaginated,
    serializeDates,
    filters: { buildMultiValueFilter, buildSingleValueFilter, buildDateRangeFilter, buildPartialMatchFilter },
  } = getRepository(NosanaCollections.DEPLOYMENTS);

  const { count: countJobs } = getRepository(NosanaCollections.JOBS);

  try {
    const { items: deployments, pagination } = await findPaginated({
      baseFilter: { owner: userId },
      additionalFilters: [
        buildPartialMatchFilter([DeploymentDocumentFields.ID, DeploymentDocumentFields.NAME], search),
        buildMultiValueFilter(DeploymentDocumentFields.STATUS, status),
        buildMultiValueFilter(DeploymentDocumentFields.STRATEGY, strategy),
        buildMultiValueFilter(DeploymentDocumentFields.ID, id),
        buildSingleValueFilter(DeploymentDocumentFields.NAME, name),
        buildSingleValueFilter(DeploymentDocumentFields.VAULT, vault),
        buildDateRangeFilter(DeploymentDocumentFields.CREATED_AT, created_after, created_before)
      ],
      sortField: DeploymentDocumentFields.CREATED_AT,
      sortOrder: sort_order,
      limit: parseInt(String(limit)),
      cursor,
    });

    // Add active_jobs count for each deployment
    const deploymentsWithActiveJobs = await Promise.all(
      deployments.map(async (deployment) => {
        const activeJobsCount = await countJobs({
          deployment: deployment.id,
          state: JobState.RUNNING
        });

        return {
          ...serializeDates(deployment),
          active_jobs: activeJobsCount,
        };
      })
    );

    res.status(200);

    return {
      deployments: deploymentsWithActiveJobs,
      pagination,
    };
  } catch (error) {
    req.log.error("Error fetching deployments: %s", String(error));
    res.status(500).send({ error: "Internal Server Error" });
  }
};
