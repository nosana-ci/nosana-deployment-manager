import assert from "node:assert";

import { Deployment } from "@nosana/api";
import { address, DeploymentStatus, DeploymentStrategy, NosanaApi, NosanaClient } from "@nosana/kit";

import { pollDeployment, sleep } from "../utils/pollDeployment.js";
import { createSimpleDeploymentBody } from "../utils/deploymentBody.js";

import { JobState } from "../../../src/types/index.js";

export default async function testSimpleScenario(deployer: NosanaClient, vault: NosanaClient) {
  console.log("Running simple scenario test...");
  let deployment: Deployment;
  let firstJob: string;
  console.log("Creating new deployment with SIMPLE strategy...");

  deployment = await (deployer.api as NosanaApi).deployments.create(createSimpleDeploymentBody());

  assert(deployment.strategy === DeploymentStrategy.SIMPLE, `Deployment strategy does not match SIMPLE strategy. Expected: ${DeploymentStrategy.SIMPLE}, Got: ${deployment.strategy}`);
  assert(deployment.vault.address.toString() === vault.wallet!.address.toString(), `Deployment vault does not match the expected vault. Expected: ${vault.wallet!.address.toString()}, Got: ${deployment.vault.address.toString()}`);
  console.log("Deployment created with ID:", deployment.id);
  console.log("Checking vault balance...");
  const balance = await deployment.vault.getBalance();

  console.log("Vault balance:", balance);
  assert(balance.SOL > 0.001, `Vault SOL balance is insufficient after deployment creation. Expected more than 0.001, Got: ${balance.SOL}`);
  assert(balance.NOS > 0.1, `Vault NOS balance is insufficient after deployment creation. Expected more than 0.1, Got: ${balance.NOS}`);

  console.log("Starting deployment...");
  await deployment.start();

  assert(deployment.status === DeploymentStatus.STARTING, `Deployment status is not 'starting' after starting. Expected: ${DeploymentStatus.STARTING}, Got: ${deployment.status}`);

  console.log("Deployment starting, polling for running status...");
  deployment = await pollDeployment(deployer, deployment, (d) => d.status === DeploymentStatus.RUNNING)

  assert(deployment.status === DeploymentStatus.RUNNING, `Deployment did not reach 'running' status. Expected: ${DeploymentStatus.RUNNING}, Got: ${deployment.status}`);
  console.log("Deployment is now running.");

  console.log("Polling deployment for first job");
  deployment = await pollDeployment(deployer, deployment, (d) => d.jobs.length === 1)

  assert(deployment.jobs.length === 1, `No jobs found in deployment after polling. Expected: 1, Got: ${deployment.jobs.length}`);
  firstJob = deployment.jobs[0].job;

  await sleep(30 * 1000);

  console.log("Stopping deployment...");
  await deployment.stop();
  assert(deployment.status === DeploymentStatus.STOPPING, `Deployment status is not 'stopped' after stopping. Expected: ${DeploymentStatus.STOPPING}, Got: ${deployment.status}`);
  console.log("Deployment stopping, polling for stopped status...");
  deployment = await pollDeployment(deployer, deployment, (d) => d.status === DeploymentStatus.STOPPED)

  assert(deployment.status === DeploymentStatus.STOPPED, `Deployment did not reach 'stopped' status. Expected: ${DeploymentStatus.STOPPED}, Got: ${deployment.status}`);
  // @ts-expect-error Job state is not yet reflected in kit types
  assert(deployment.jobs.every((job) => job.state === JobState.STOPPED), `Not all jobs are stopped in the deployment. Jobs: ${JSON.stringify(deployment.jobs)}`);

  console.log("Deployment stopped successfully and stopped all running jobs.");

  console.log("Restarting deployment...");
  await deployment.start();

  assert(deployment.status === DeploymentStatus.STARTING, `Deployment status is not 'starting' after restarting. Expected: ${DeploymentStatus.STARTING}, Got: ${deployment.status}`);
  console.log("Deployment restarting, polling for running status...");
  deployment = await pollDeployment(deployer, deployment, (d) => d.status === DeploymentStatus.RUNNING);

  assert(deployment.status === DeploymentStatus.RUNNING, `Deployment did not reach 'running' status after restart. Expected: ${DeploymentStatus.RUNNING}, Got: ${deployment.status}`);
  console.log("Deployment restarted successfully and is now running.");

  console.log("Polling for new jobs...");
  deployment = await pollDeployment(deployer, deployment, (d) => d.jobs.length === 2);

  assert(deployment.jobs.length === 2, `Jobs were not recreated after deployment restart. Expected: 2, Got: ${deployment.jobs.length}`);
  // @ts-expect-error Job state is not yet reflected in kit types
  assert(deployment.jobs.some((job) => job.state !== JobState.STOPPED), `Not all jobs are running after deployment restart. Jobs: ${deployment.jobs}`);

  const secondJob = address(deployment.jobs.find((job) => job.job !== firstJob)!.job);

  await sleep(30 * 1000);

  const job = await vault.jobs.get(secondJob);
  assert(job, `Job ${secondJob} not found onchain.`);

  if (job.state === 0) {
    const instruction = await vault.jobs.delist({ job: secondJob });
    await vault.solana.buildSignAndSend(instruction);
  } else if (job.state === 1) {
    const instruction = await vault.jobs.end({ job: secondJob });
    await vault.solana.buildSignAndSend(instruction);
  } else {
    assert.fail(`Job ${secondJob} is in an unexpected state: ${job.state}`);
  }

  console.log("Second job ended successfully.");
  console.log("Polling deployment for stopped status...");
  deployment = await pollDeployment(deployer, deployment, (d) => d.status === DeploymentStatus.STOPPED);

  assert(deployment.status === DeploymentStatus.STOPPED, `Deployment did not reach 'stopped' status after ending second job. Expected: ${DeploymentStatus.STOPPED}, Got: ${deployment.status}`);
  console.log("Deployment stopped successfully after ending second job.");
}