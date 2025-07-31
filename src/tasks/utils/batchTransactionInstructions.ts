import { Client, sleep } from "@nosana/sdk";
import {
  ComputeBudgetProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

// const instructionSizes = {
//   list: 1,
//   extend: 2,
//   stop: 3,
// };

export async function batchTransactionInstructions(
  instructions: Array<TransactionInstruction>,
  sdk: Client
) {
  const currentTransaction = new Transaction();
  await sleep(0.15);
  const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: 5,
  });
  currentTransaction.add(addPriorityFee);
  currentTransaction.add(...instructions);
  const tx = await sdk.jobs.provider?.sendAndConfirm(currentTransaction);
  return tx;
}
