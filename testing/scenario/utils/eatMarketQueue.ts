import { address, NosanaClient, MarketQueueType } from "@nosana/kit";
import { finishJob, joinMarketQueue } from "../common";

export async function eatMarketQueue(marketAddress: string, node: NosanaClient) {
  const market = await node.jobs.market(address(marketAddress));
  if (market.queueType !== MarketQueueType.JOB_QUEUE) throw new Error("Market is not eatable");

  for (const job of market.queue) {
    await joinMarketQueue(() => marketAddress)();
    await finishJob(() => job.toString());
  }
}