import { Static, Type } from "@sinclair/typebox";

import { PublicKeySchema } from "./publicKey.schema.js";
import { EndpointSchema } from "./endpoint.schema.js";
import { DeploymentStatusSchema } from "./deployment.schema.js";
import { TaskTypeSchema } from "./task.schema.js";

import { EventType, JobState, TaskStatus } from "../../../types/index.js";

const JobStateSchema = Type.Union(
  Object.values(JobState).map((val) => Type.Literal(val))
);

const TaskStatusSchema = Type.Union(
  Object.values(TaskStatus).map((val) => Type.Literal(val))
);

/**
 * One frame of the deployment event stream.
 *
 * The route answers with `text/event-stream`, so this never reaches a
 * serializer: it exists to describe the frames in the OpenAPI document, from
 * which the clients generate their types. `DeploymentStreamEvent` is derived
 * from it, so a change here is a change to what the stream may emit.
 */
export const DeploymentStreamEventSchema = Type.Union([
  Type.Object({
    type: Type.Literal("deployment"),
    status: DeploymentStatusSchema,
    replicas: Type.Number({ minimum: 0 }),
    active_revision: Type.Number({ minimum: 1 }),
  }),
  Type.Object({
    type: Type.Literal("job"),
    job: PublicKeySchema,
    state: JobStateSchema,
    node: Type.Union([PublicKeySchema, Type.Null()]),
    timeStart: Type.Number({ minimum: 0 }),
    timeEnd: Type.Number({ minimum: 0 }),
  }),
  // A new entry in the deployment's event log; `event` is the entry's own type.
  Type.Object({
    type: Type.Literal("event"),
    category: Type.Union(
      Object.values(EventType).map((val) => Type.Literal(val))
    ),
    event: Type.String(),
    message: Type.String(),
    tx: Type.Union([Type.String(), Type.Null()]),
    created_at: Type.String({ format: "date-time" }),
  }),
  Type.Object({
    type: Type.Literal("task"),
    id: Type.String(),
    task: TaskTypeSchema,
    status: TaskStatusSchema,
    attempts: Type.Number({ minimum: 0 }),
    due_at: Type.String({ format: "date-time" }),
    job: Type.Union([Type.String(), Type.Null()]),
  }),
  // One of the deployment's endpoints, exactly as `GET /deployments/:id` returns
  // it, with its current reachability. Sent whole rather than as a status delta,
  // so a client can render it without holding the endpoint list.
  Type.Composite([Type.Object({ type: Type.Literal("endpoint") }), EndpointSchema]),
  // The task left the queue: completed, or cancelled along with its deployment.
  Type.Object({
    type: Type.Literal("task"),
    id: Type.String(),
    task: TaskTypeSchema,
    status: Type.Literal("DONE"),
  }),
]);

export type DeploymentStreamEventSchema = Static<
  typeof DeploymentStreamEventSchema
>;
