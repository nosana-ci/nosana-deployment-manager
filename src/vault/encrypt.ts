import crypto from "crypto";

import { algorithm, salt } from "./index.js";
import { getConfig } from "../config/index.js";

export function encryptWithKey(value: string): string {
  const password = getConfig().vault_key;
  if (!password) return value;

  const iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 32);
  const cipher = crypto.createCipheriv(algorithm, key, iv);

  let encrypted = cipher.update(value, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
}