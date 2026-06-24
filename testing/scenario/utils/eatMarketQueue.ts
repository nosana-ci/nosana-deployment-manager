import { address, NosanaClient, MarketQueueType } from "@nosana/kit";
import { finishJob, joinMarketQueue } from "../common";

export async function eatMarketQueue(marketAddress: string, node: NosanaClient) {
  const market = await node.jobs.market(address(marketAddress));
  // Nothing to eat: the market has no pending jobs (it's empty or holds a node
  // queue), so it is already "drained" for our purposes. Treat as a no-op rather
  // than an error, so EAT is usable as an idempotent setup step regardless of the
  // shared market's current state.
  if (market.queueType !== MarketQueueType.JOB_QUEUE) return;

  for (const job of market.queue) {
    // Don't verify the node lands in the queue here: eating a job means the node
    // gets matched to it and starts RUNNING, so it is deliberately NOT in the
    // market queue afterwards. (The default verifyQueued:true only holds when the
    // market is empty, which is never the case while draining pending jobs.)
    await joinMarketQueue(() => marketAddress, { verifyQueued: false })();
    await finishJob(() => job.toString());
  }
}