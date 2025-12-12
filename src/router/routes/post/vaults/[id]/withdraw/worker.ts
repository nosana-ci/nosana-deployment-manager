import { address } from "@solana/addresses";
import { parentPort, workerData } from "worker_threads";

import { prepareWorker, workerErrorFormatter, VaultWorkerData } from "../../../../../../worker/Worker.js";

try {
  const { owner, kit } = await prepareWorker<VaultWorkerData<{ owner: string }>>(workerData);

  const transactions = [];
  const nosBalance = await kit.nos.getBalance(kit.wallet!.address);
  const solBalance = await kit.solana.getBalance();

  if (solBalance > 0) {
    const solTransferInstructions = await kit.solana.transfer({
      to: owner,
      amount: solBalance,
    });
    transactions.push(solTransferInstructions);
  }

  if (nosBalance > 0) {
    const nosTransferInstructions = await kit.nos.transfer({
      to: owner,
      amount: nosBalance,
    });
    for (const instruction of nosTransferInstructions) {
      transactions.push(instruction);
    }
  }

  if (transactions.length === 0) {
    parentPort!.postMessage({
      event: "SUCCESS",
      data: null,
    });
    process.exit(0);
  }

  const transaction = await kit.solana.buildTransaction(transactions, {
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