import { Static, Type } from "@sinclair/typebox";

import { PublicKeySchema } from "./publicKey.schema.js";

export const HeadersSchema = Type.Object(
  {
    "x-user-id": PublicKeySchema,
    authorization: Type.String({
      description: "Signed authentication message,",
    }),
  },
  {
    description: "Headers for deployment routes",
  }
);

export type HeadersSchema = Static<typeof HeadersSchema>;

export const HostHeadersSchema = Type.Object(
  {
    authorization: Type.String({
      description: "Signed authentication message,",
    }),
  },
  {
    description: "Headers for deployment routes",
  }
);

export type HostHeadersSchema = Static<typeof HostHeadersSchema>
