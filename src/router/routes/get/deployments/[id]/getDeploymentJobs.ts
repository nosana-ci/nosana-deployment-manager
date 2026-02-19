import type { RouteHandler } from "fastify";

import { getRepository } from "../../../../../repositories/index.js";
import { NosanaCollections } from "../../../../../definitions/collection.js";

import type {
  GetDeploymentJobsSuccess,
  GetDeploymentJobsError,
} from "../../../../schema/get/deployments/[id]/getDeploymentJobs.schema.js";
import type { HeadersSchema } from "../../../../schema/index.schema.js";
import type { JobsFilter } from "../../../../schema/components/filters.schema.js";
import type { PaginationQuery } from "../../../../schema/components/pagination.schema.js";
import { JobsDocumentFields } from "../../../../../types/index.js";

export const getDeploymentJobsHandler: RouteHandler<{
  Params: { deployment: string };
  Headers: HeadersSchema;
  Querystring: PaginationQuery & JobsFilter;
  Reply: GetDeploymentJobsSuccess | GetDeploymentJobsError;
}> = async (req, res) => {
  const deployment = req.params.deployment;
  const { state, job, revision, created_after, created_before, sort_order = 'desc', limit = 10, cursor } = req.query;

  const {
    findPaginated,
    serializeDates,
    filters: { buildMultiValueFilter, buildSingleValueFilter, buildDateRangeFilter },
  } = getRepository(NosanaCollections.JOBS);

  try {
    const { items, pagination } = await findPaginated({
      baseFilter: { deployment },
      additionalFilters: [
        buildMultiValueFilter(JobsDocumentFields.STATE, state),
        buildSingleValueFilter(JobsDocumentFields.JOB, job),
        buildSingleValueFilter(JobsDocumentFields.REVISION, revision),
        buildDateRangeFilter(JobsDocumentFields.CREATED_AT, created_after, created_before)
      ],
      sortField: JobsDocumentFields.CREATED_AT,
      sortOrder: sort_order,
      limit: parseInt(String(limit)),
      cursor
    })

    res.status(200).send({
      jobs: serializeDates(items),
      pagination,
    });
  } catch (error) {
    req.log.error(error);
    res.status(500).send({
      error: "Failed to get deployment jobs",
    });
  }
};
