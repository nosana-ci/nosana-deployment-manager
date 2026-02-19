import type { RouteHandler } from "fastify";

import { getRepository } from "../../../../../repositories/index.js";
import { NosanaCollections } from "../../../../../definitions/collection.js";

import type {
  GetDeploymentEventsSuccess,
  GetDeploymentEventsError,
} from "../../../../schema/get/deployments/[id]/getDeploymentEvents.schema.js";
import type { HeadersSchema } from "../../../../schema/index.schema.js";
import type { PaginationQuery } from "../../../../schema/components/pagination.schema.js";
import type { EventsFilter } from "../../../../schema/components/filters.schema.js";

export const getDeploymentEventsHandler: RouteHandler<{
  Params: { deployment: string };
  Headers: HeadersSchema;
  Querystring: PaginationQuery & EventsFilter;
  Reply: GetDeploymentEventsSuccess | GetDeploymentEventsError;
}> = async (req, res) => {
  const deploymentId = req.params.deployment;
  const { category, type: event_type, created_after, created_before, sort_order = 'desc', limit = 10, cursor } = req.query;

  const {
    findPaginated,
    serializeDates,
    filters: { buildMultiValueFilter, buildDateRangeFilter }
  } = getRepository(NosanaCollections.EVENTS);

  try {
    const { items, pagination } = await findPaginated({
      baseFilter: { deploymentId },
      additionalFilters: [
        buildMultiValueFilter('category', category),
        buildMultiValueFilter('type', event_type),
        buildDateRangeFilter('created_at', created_after, created_before)
      ],
      sortField: 'created_at',
      sortOrder: sort_order,
      limit: parseInt(String(limit)),
      cursor
    })

    res.status(200).send({
      events: serializeDates(items),
      pagination,
    });
  } catch (error) {
    req.log.error(error);
    res.status(500).send({
      error: "Failed to get deployment events",
    });
  }
};
