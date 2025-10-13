import crypto from "crypto";

import { algorithm, salt } from "./index.js";
import { getConfig } from "../config/index.js";

export function decryptWithKey(value: string): string {
  const password = getConfig().vault_key;
  if (!password) return value;

  const [ivHex, authTagHex, encrypted] = value.split(':');

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const key = crypto.scryptSync(password, salt, 32);

  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}