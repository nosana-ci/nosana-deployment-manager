import { Type } from "@sinclair/typebox";

export const EndpointSchema = Type.Object({
  opId: Type.String(),
  port: Type.Number(),
  url: Type.String(),
});
