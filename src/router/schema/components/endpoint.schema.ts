import { Type } from "@sinclair/typebox";

export const EndpointSchema = Type.Object({
  opId: Type.String(),
  port: Type.Union([Type.Number(), Type.String()]),
  url: Type.String(),
  online: Type.Boolean({
    description:
      "Whether the deployment currently answers here. Per opId: a node opens one load-balanced proxy per op, so every port that op exposes reports the same value.",
  }),
});
