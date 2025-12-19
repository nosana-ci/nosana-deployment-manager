import { NosanaClient, Job, address } from "@nosana/kit";
import { sleep } from "./pollDeployment";

export async function pollJob(
  deployer: NosanaClient,
  jobId: string,
  checkStatement: (job: Job) => boolean,
  interval = 1000, maxAttempts = 100
): Promise<Job | undefined> {
  let attempts = 0;
  while (attempts < maxAttempts) {
    const updatedJob = await deployer.jobs.get(address(jobId));
    if (checkStatement(updatedJob)) {
      return updatedJob;
    }
    await sleep(interval);
    attempts++;
  }
}