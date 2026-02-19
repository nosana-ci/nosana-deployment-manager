import type { RouteHandler } from "fastify";

import { getRepository } from "../../../../../repositories/index.js";
import { NosanaCollections } from "../../../../../definitions/collection.js";

import type {
  GetDeploymentRevisionsSuccess,
  GetDeploymentRevisionsError,
} from "../../../../schema/get/deployments/[id]/getDeploymentRevisions.schema.js";
import type { HeadersSchema } from "../../../../schema/index.schema.js";
import type { PaginationQuery } from "../../../../schema/components/pagination.schema.js";
import type { RevisionsFilter } from "../../../../schema/components/filters.schema.js";

export const getDeploymentRevisionsHandler: RouteHandler<{
  Params: { deployment: string };
  Headers: HeadersSchema;
  Querystring: PaginationQuery & RevisionsFilter;
  Reply: GetDeploymentRevisionsSuccess | GetDeploymentRevisionsError;
}> = async (req, res) => {
  const deployment = req.params.deployment;
  const { revision, created_after, created_before, sort_order = 'desc', limit = 10, cursor } = req.query;

  const {
    findPaginated,
    serializeDates,
    filters: { buildSingleValueFilter, buildDateRangeFilter },
  } = getRepository(NosanaCollections.REVISIONS);

  try {
    const { items, pagination } = await findPaginated({
      baseFilter: { deployment },
      additionalFilters: [
        buildSingleValueFilter('revision', revision),
        buildDateRangeFilter('created_at', created_after, created_before)
      ],
      sortField: 'created_at',
      sortOrder: sort_order,
      limit: parseInt(String(limit)),
      cursor,
    });

    res.status(200).send({
      revisions: serializeDates(items),
      pagination,
    });
  } catch (error) {
    req.log.error(error);
    res.status(500).send({
      error: "Failed to get deployment revisions",
    });
  }
};
