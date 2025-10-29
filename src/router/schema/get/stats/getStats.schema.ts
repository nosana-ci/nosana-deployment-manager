import { FastifySchema } from "fastify";
import { Type, Static } from "@sinclair/typebox";

export const StatsHandlerSuccess = Type.Object({
  running_ms: Type.Number({ description: "Total running time of the deployment manager in milliseconds." }),
  started_at: Type.String({ format: "date-time" }),
  jobs: Type.Object({
    listed: Type.Number({ description: "Total number of listing jobs processed." }),
    extended: Type.Number({ description: "Total number of extension jobs processed." }),
    stopped: Type.Number({ description: "Total number of stopping jobs processed." }),
  }),
  tasks: Type.Object({
    in_progress: Type.Number({ description: "Number of tasks currently in progress." }),
    failed: Type.Number({ description: "Total number of failed tasks." }),
    successful: Type.Number({ description: "Total number of successful tasks." }),
    timed_out: Type.Number({ description: "Total number of timed out tasks." }),
    average_time_ms: Type.Number({ description: "Average time taken to complete tasks in milliseconds." }),
  })
});

export type StatsHandlerSuccess = Static<typeof StatsHandlerSuccess>;

export const StatsHandlerSchema: FastifySchema = {
  description: "Get deployment manager statistics.",
  hide: true,
  response: {
    200: {
      description: "Deployment manager statistics.",
      content: {
        "application/json": {
          schema: StatsHandlerSuccess,
        },
      },
    }
  }
};
