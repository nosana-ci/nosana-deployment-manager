import { address } from "@solana/addresses";
import type { NosanaClient } from "@nosana/kit";

export async function checkJobExists(kit: NosanaClient, jobAddress: string): Promise<boolean> {
  try {
    await kit.jobs.get(address(jobAddress));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message === "Account does not exist or has no data") {
      return false;
    }
    // Re-throw other errors
    throw error;
  }
}