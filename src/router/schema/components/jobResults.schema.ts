import { Static, Type } from "@sinclair/typebox";

export const JobResultsSchema = Type.Object({
  status: Type.String(),
  startTime: Type.Number(),
  endTime: Type.Number(),
  secerts: Type.Object(Type.Any()),
  opStates: Type.Array(
    Type.Object({
      operationId: Type.String(),
      providerId: Type.String(),
      status: Type.String(),
      startTime: Type.Number(),
      endTime: Type.Number(),
      exitCode: Type.Number(),
      logs: Type.Array(
        Type.Object({
          log: Type.String(),
          type: Type.Union([
            Type.Literal("stdout"), Type.Literal("stderr"), Type.Literal("noderr")
          ])
        })
      )
    })
  )
});

export type JobResultsSchema = Static<typeof JobResultsSchema>