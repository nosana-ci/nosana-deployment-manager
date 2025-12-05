import { createNosanaClient, NosanaNetwork } from "@nosana/kit";
import { parentPort, workerData } from "worker_threads";
import { createKeyPairSignerFromBytes } from "@solana/signers";

import { decryptWithKey } from "../../../../../../vault/decrypt.js";
import { covertStringToIterable } from "../../../../../../tasks/utils/convertStringToIterable.js";

try {
  const { register } = await import("ts-node");
  register();
} catch {
  /* empty */
}

type WorkerData = {
  includeTime: boolean;
  config: { network: NosanaNetwork; rpc_network: string };
  vault: string;
};

const { includeTime, config: { network, rpc_network }, vault } = workerData as WorkerData;

const key = decryptWithKey(vault);

try {
  const kit = createNosanaClient(network, {
    wallet: await createKeyPairSignerFromBytes(new Uint8Array(covertStringToIterable(key))),
    solana: { rpcEndpoint: rpc_network },
  });

  const header = await kit.authorization.generate("DEPLOYMENT_HEADER", {
    includeTime,
  });

  parentPort!.postMessage({
    event: "GENERATED",
    header,
  });
} catch (error) {
  parentPort!.postMessage({
    event: "ERROR",
    error,
  });
}
