import { FastifySchema } from "fastify";

/** The open-ended stream has no serializable response schema. */
export const StreamDeploymentEventsSchema: FastifySchema = {
  description:
    "Server-sent stream of a deployment's changes. Each message is a JSON object discriminated by `type`: " +
    "{type:'deployment',status,replicas,active_revision}; " +
    "{type:'job',job,state,node,timeStart,timeEnd} with state QUEUED|RUNNING|COMPLETED|STOPPED; " +
    "{type:'event',category,event,message,tx,created_at} for a new entry in the deployment's event log; " +
    "{type:'task',id,task,status,attempts,due_at,job} for a queued LIST|EXTEND|STOP task with status PENDING|PROCESSING, " +
    "or {type:'task',id,task,status:'DONE'} once it has left the queue. " +
    "The stream starts with the current deployment, its active jobs and its outstanding tasks, then emits live changes. " +
    "Historical jobs and events remain available through their paginated endpoints.",
  tags: ["Deployments"],
  headers: {
    $ref: "Headers",
  },
  params: {
    type: "object",
    properties: {
      deployment: {
        $ref: "PublicKey",
      },
    },
    required: ["deployment"],
  },
};
