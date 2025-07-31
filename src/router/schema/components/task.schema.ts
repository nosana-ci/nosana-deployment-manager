import { Type } from "@sinclair/typebox";

import { PublicKeySchema } from "./publicKey.schema.js";

import { TaskType } from "../../../types/index.js";

export const TaskTypeSchema = Type.Union(
  Object.values(TaskType).map((val) => Type.Literal(val))
);

export const TaskSchema = Type.Object({
  task: TaskTypeSchema,
  deploymentId: PublicKeySchema,
  tx: Type.Optional(Type.String()),
  due_at: Type.String({ format: "date-time" }),
  created_at: Type.String({ format: "date-time" }),
});
