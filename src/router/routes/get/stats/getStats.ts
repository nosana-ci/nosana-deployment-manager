import { RouteHandler } from "fastify";

import { StatsHandlerSuccess } from "../../../schema/get/index.schema.js";
import { getStats } from "../../../../stats/index.js";

export const getStatsHandler: RouteHandler<{
  Reply: StatsHandlerSuccess
}> = (_, res) => {
  const stats = getStats();
  res.status(200).send({
    ...stats,
    running_ms: new Date().getTime() - stats.started_at.getTime(),
    started_at: stats.started_at.toISOString(),
  });
};

