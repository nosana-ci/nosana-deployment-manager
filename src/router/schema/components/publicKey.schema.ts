import { Type } from "@sinclair/typebox";

export const PublicKeySchema = Type.String({ minLength: 43, maxLength: 44 });
