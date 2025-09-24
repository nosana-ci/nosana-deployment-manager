import { Type } from "@sinclair/typebox";

export const EndpointSchema = Type.Object({
  opId: Type.String(),
  port: Type.Union([Type.Number(), Type.String()]),
  url: Type.String(),
});
