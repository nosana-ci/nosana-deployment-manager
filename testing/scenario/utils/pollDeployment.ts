import { Deployment, NosanaApi } from "@nosana/api";
import { NosanaClient } from "@nosana/kit";

async function sleep(ms: number = 1000) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pollDeployment(
  deployer: NosanaClient,
  deployment: Deployment,
  checkStatement: (deployment: Deployment) => boolean,
  interval = 1000, maxAttempts = 100
): Promise<Deployment> {
  let attempts = 0;
  while (attempts < maxAttempts) {
    const updatedDeployment = await (deployer.api as NosanaApi).deployments.get(deployment.id);
    if (checkStatement(updatedDeployment)) {
      return updatedDeployment;
    }
    await sleep(interval);
    attempts++;
  }
  return deployment
}