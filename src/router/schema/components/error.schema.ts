import { Static, Type } from "@sinclair/typebox";

export const ErrorSchema = Type.Object({
  error: Type.String(),
});
export type ErrorSchema = Static<typeof ErrorSchema>;
