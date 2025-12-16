import { address } from "@solana/addresses";
import { parentPort, workerData } from "worker_threads";

import { prepareWorker, workerErrorFormatter, VaultWorkerData } from "../../../../../../worker/Worker.js";

try {
  const { owner, kit } = await prepareWorker<VaultWorkerData<{ owner: string }>>(workerData);

  const instructions = [];
  const SOL = await kit.solana.getBalance();
  const NOS = await kit.nos.getBalance();

  if (SOL && SOL > 0) {
    instructions.push(await kit.solana.transfer({
      to: owner,
      amount: SOL,
    }));
  }

  if (NOS && NOS > 0) {
    instructions.push(...await kit.nos.transfer({
      to: owner,
      amount: NOS * 1e6,
    }));
  }

  if (instructions.length === 0) {
    parentPort!.postMessage({
      event: "SUCCESS",
      data: null,
    });
    process.exit(0);
  }

  const transaction = await kit.solana.buildTransaction(instructions, {
    feePayer: address(owner)
  });
  const partiallySignedTx = await kit.solana.partiallySignTransaction(transaction);
  const serializedTx = kit.solana.serializeTransaction(partiallySignedTx);

  parentPort!.postMessage({
    event: "SUCCESS",
    data: serializedTx,
  });
  process.exit(0);
} catch (error) {
  parentPort!.postMessage({
    event: "ERROR",
    error: workerErrorFormatter(error),
  });
  process.exit(1);
}