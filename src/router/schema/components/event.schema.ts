import { Type } from "@sinclair/typebox";

import { PublicKeySchema } from "./publicKey.schema.js";

import { EventType } from "../../../types/index.js";

export const EventsSchema = Type.Object({
  category: Type.Union(
    Object.values(EventType).map((val) => Type.Literal(val))
  ),
  deploymentId: PublicKeySchema,
  type: Type.String(),
  message: Type.String(),
  tx: Type.Optional(Type.String()),
  created_at: Type.String({ format: "date-time" }),
});
