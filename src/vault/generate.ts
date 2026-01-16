import bs58 from "bs58"

import { encryptWithKey } from "./index.js";

async function generateKeyPair() {
  const { publicKey, privateKey } = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"]
  );

  const [extractedPublicKey, extractedPrivateKey] = await Promise.all([
    crypto.subtle.exportKey("raw", publicKey),
    crypto.subtle.exportKey("pkcs8", privateKey)
  ]);
  return { publicKey, extractedPublicKey, extractedPrivateKey };
}

export async function generateVault(): Promise<[string, string]> {
  const { extractedPublicKey, extractedPrivateKey } = await generateKeyPair();

  const bs58PublicKey = bs58.encode(new Uint8Array(extractedPublicKey));
  const encryptedPrivateKey = encryptWithKey(
    new Uint8Array(extractedPrivateKey).slice(-32).toString()
  );

  return [bs58PublicKey, encryptedPrivateKey];
}