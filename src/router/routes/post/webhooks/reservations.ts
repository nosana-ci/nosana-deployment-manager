import type { RouteHandler } from "fastify";

import { ErrorMessages } from "../../../../errors/index.js";
import { cancelReservationRequest } from "../../../../client/hostManager/index.js";
import { recordRequestFulfilment } from "../../../../tasks/task/list/reserve.js";

import type {
  ReservationWebhookBody,
  ReservationWebhookError,
  ReservationWebhookSuccess,
} from "../../../schema/post/index.schema.js";

/**
 * Host-manager filled a waiting reservation request (its key is the LIST task's
 * id). The nodes are recorded on that task and it is made due, so the LIST
 * worker assigns them within their hold; 200 only once that write is done. A
 * redelivery is a no-op. When the task is gone (its deployment stopped) or has
 * no request, the nodes are released.
 */
export const reservationWebhookHandler: RouteHandler<{
  Body: ReservationWebhookBody;
  Reply: ReservationWebhookSuccess | ReservationWebhookError;
}> = async (req, res) => {
  const { db } = res.locals;
  const { key } = req.body;

  try {
    const accepted = await recordRequestFulfilment(db.tasks, req.body);
    if (!accepted) {
      cancelReservationRequest(key).catch((error: unknown) =>
        res.log.error({ err: error, key }, "failed to release an unclaimed reservation")
      );
    }
    res.status(200).send({ accepted });
  } catch (error) {
    res.log.error(error);
    res.status(500).send({ error: ErrorMessages.generic.SOMETHING_WENT_WRONG });
  }
};
