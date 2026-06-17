import type { Collection } from "mongodb";

export const EventType = {
  DEPLOYMENT: "Deployment",
  EVENT: "Event",
} as const;

export type EventType = (typeof EventType)[keyof typeof EventType];

export type EventDocument = {
  category: EventType;
  deploymentId: string;
  type: string;
  message: string;
  tx?: string | undefined;
  created_at: Date;
};

export type EventsCollection = Collection<EventDocument>;
