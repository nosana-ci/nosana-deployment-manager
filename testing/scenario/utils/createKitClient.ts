import fs from 'fs';
import os from 'os';
import { createNosanaClient } from '@nosana/kit';
import { createKeyPairSignerFromPrivateKeyBytes } from '@solana/signers';

export const createTestClient = async (keyPath: string) => {
  const key = JSON.parse(
    fs.readFileSync(os.homedir() + keyPath, 'utf8')
  );

  const client = createNosanaClient('devnet', {
    logLevel: 'none',
    api: {
      backend_url: "http://localhost:3001",
    }
  });
  client.wallet = await createKeyPairSignerFromPrivateKeyBytes(
    new Uint8Array(key).slice(0, 32)
  );
  return client;
};