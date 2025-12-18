import assert from "node:assert";

import { Deployment } from "@nosana/api";
import { address, DeploymentStatus, DeploymentStrategy, NosanaApi, NosanaClient, JobState } from "@nosana/kit";

import { pollJob } from "../utils/pollJob.js";
import { pollDeployment, sleep } from "../utils/pollDeployment.js";
import { createSimpleDeploymentBody } from "../utils/deploymentBody.js";

export default async function (deployer: NosanaClient, vault: NosanaClient) {
  console.log("Running simple extend scenario test...");
  let deployment: Deployment;
  let firstJob: string;

  console.log("Creating new deployment with SIMPLE strategy...");
  deployment = await (deployer.api as NosanaApi).deployments.create(createSimpleDeploymentBody({ strategy: DeploymentStrategy["SIMPLE-EXTEND"] }));

  assert(deployment.strategy === DeploymentStrategy["SIMPLE-EXTEND"], `Deployment strategy does not match SIMPLE-EXTEND strategy. Expected: ${DeploymentStrategy["SIMPLE-EXTEND"]}, Got: ${deployment.strategy}`);
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

  await sleep(3 * 1000);

  let job = await pollJob(deployer, firstJob, (job) => job.state === JobState.RUNNING);
  assert(!job, `Job ${firstJob} not found onchain.`);
  assert(job!.state === JobState.RUNNING, `Job ${firstJob} is not in RUNNING state. Current state: ${job!.state}`);

  console.log("First job is running as expected.");

  const tasks = await deployment.getTasks();
  assert(tasks.length === 1, `Deployment should have 1 task running. Found: ${tasks.length}`);
  assert(tasks[0].task === "EXTEND", `Task does not match expected 'EXTEND'. Expected: EXTEND, Got: ${tasks[0].task}`);
  // @ts-expect-error Status is not yet reflected in kit types
  assert(tasks[0].job === firstJob, `Task job does not match first job. Expected: ${firstJob}, Got: ${tasks[0].job}`);

  const expectedDueAt = new Date(Number(job!.timeStart) + Number(job!.timeout) - 60 * 1000);
  assert(tasks[0].due_at === expectedDueAt.toString());

  await sleep(expectedDueAt.getTime() - Date.now() + 5 * 1000);

  const updatedJob = await pollJob(deployer, firstJob, (j) => Number(j.timeout) > Number(job!.timeout));
  assert(updatedJob!.timeout === job!.timeout, `Job timeout was not extended. Expected greater than: ${job!.timeout}, Got: ${updatedJob!.timeout}`);
  assert(updatedJob!.timeout !== Number(job!.timeout) * 2, `Job timeout was not extended correctly. Expected: ${Number(job!.timeout) * 2}, Got: ${updatedJob!.timeout}`);

  const tasksAfterExtend = await deployment.getTasks();
  assert(tasksAfterExtend.length === 0, `All tasks should be completed after extend. Found: ${tasksAfterExtend.length}`);

  const instruction = await vault.jobs.end({ job: address(firstJob) });
  await vault.solana.buildSignAndSend(instruction);

  console.log("Ending first job...");
  job = await pollJob(deployer, firstJob, (j) => j.state > 1);
  assert(job!.state <= 2, `Job ${firstJob} did not reach ENDED state. Current state: ${job!.state}`);

  deployment = await pollDeployment(deployer, deployment, (d) => d.status === DeploymentStatus.STOPPING);

  assert(deployment.status === DeploymentStatus.STOPPING, `Deployment status is not 'stopped' after stopping. Expected: ${DeploymentStatus.STOPPING}, Got: ${deployment.status}`);
  console.log("Deployment stopping, polling for stopped status...");
  deployment = await pollDeployment(deployer, deployment, (d) => d.status === DeploymentStatus.STOPPED)

  assert(deployment.status === DeploymentStatus.STOPPED, `Deployment did not reach 'stopped' status. Expected: ${DeploymentStatus.STOPPED}, Got: ${deployment.status}`);
  // @ts-expect-error Job state is not yet reflected in kit types
  assert(deployment.jobs.every((job) => !["QUEUED", "RUNNING"].includes(job.state)), `Not all jobs are stopped in the deployment. Jobs: ${JSON.stringify(deployment.jobs)}`);

  const tasksAfterStop = await deployment.getTasks();
  assert(tasksAfterStop.length === 0, `All tasks should be cleared after deployment stop. Found: ${tasksAfterStop.length}`);

  console.log("Deployment stopped successfully and stopped all running jobs.");

}