import { parentPort, workerData } from "worker_threads";

import { prepareWorker, workerErrorFormatter, VaultWorkerData } from "../../../../../../worker/Worker.js";

try {
  const { owner, kit } = await prepareWorker<VaultWorkerData<{ owner: string }>>(workerData);

  const nosBalance = await kit.nos.getBalance(kit.wallet!.address);
  const solBalance = await kit.solana.getBalance();

  await kit.solana.transfer({
    to: owner,
    amount: solBalance,
  });

  await kit.nos.transfer({
    to: owner,
    amount: nosBalance,
  });

  // const transaction = await kit.solana.buildTransaction([solanaTransferInstruction, ...nosTransferInstruction]);

  // const serializedTx = serialize transaction.serialize({

} catch (error) {
  parentPort!.postMessage({
    event: "ERROR",
    error: workerErrorFormatter(error),
  });
  process.exit(1);
}