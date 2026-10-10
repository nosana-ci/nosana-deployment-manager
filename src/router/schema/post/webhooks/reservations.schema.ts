import { FastifySchema } from "fastify";
import { Static, Type } from "@sinclair/typebox";

import type { ErrorSchema } from "../../index.schema.js";

/** Host-manager sends more (`deliveryId`, `status`, `requested`); only these are read. */
const ReservationWebhookBody = Type.Object({
  key: Type.String({ minLength: 1, maxLength: 128, description: "The LIST task's id." }),
  nodes: Type.Array(Type.Object({ nodeAddress: Type.String(), market: Type.String() })),
  holdExpiresAt: Type.String({ format: "date-time" }),
});

const ReservationWebhookSuccess = Type.Object({
  accepted: Type.Boolean({
    description: "Whether the nodes were recorded for a waiting LIST; false when that task is gone and they were released.",
  }),
});

export type ReservationWebhookBody = Static<typeof ReservationWebhookBody>;
export type ReservationWebhookSuccess = Static<typeof ReservationWebhookSuccess>;
export type ReservationWebhookError = ErrorSchema;

export const ReservationWebhookSchema: FastifySchema = {
  description:
    "Host-manager filled a waiting reservation request. Internal route, authenticated by the shared host-manager API key as `authorization`.",
  hide: true,
  body: ReservationWebhookBody,
  response: {
    200: {
      description: "The fulfilment was handled (recorded, a repeat, or released).",
      content: {
        "application/json": {
          schema: ReservationWebhookSuccess,
        },
      },
    },
    401: {
      description: "Unauthorized. Invalid or missing signature.",
      content: {
        "application/json": {
          schema: Type.Literal("Unauthorized"),
        },
      },
    },
    500: {
      description: "Internal Server Error.",
      content: {
        "application/json": {
          schema: {
            $ref: "Error",
          },
        },
      },
    },
  },
};
