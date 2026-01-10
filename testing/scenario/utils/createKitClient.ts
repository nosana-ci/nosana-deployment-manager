import fs from 'fs';
import os from 'os';
import { createNosanaClient, NosanaClient } from '@nosana/kit';
import { createKeyPairSignerFromPrivateKeyBytes } from '@solana/signers';

import { encryptWithKey } from '../../../src/vault/encrypt.js';

export const createKitClient = async (keyPath: string): Promise<{
  client: NosanaClient,
  encryptedPrivateKey: string
}> => {
  const privateKeyRaw = JSON.parse(
    fs.readFileSync(keyPath.startsWith("~") ? os.homedir() + keyPath.slice(1) : keyPath, 'utf8')
  );

  if (!privateKeyRaw) {
    throw new Error("Key file not found.");
  }

  const client = createNosanaClient('devnet', {
    logLevel: 'none',
    api: {
      backend_url: "http://localhost:3001",
    }
  });

  const privateKey = new Uint8Array(privateKeyRaw).slice(0, 32)
  client.wallet = await createKeyPairSignerFromPrivateKeyBytes(
    privateKey
  );

  const encryptedPrivateKey = encryptWithKey(
    privateKey.toString()
  );

  return {
    client,
    encryptedPrivateKey
  };
};