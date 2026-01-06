import {describe, it, expect, afterAll} from 'vitest';
import { Deployment } from "@nosana/api";
import { DeploymentStatus, DeploymentStrategy } from "@nosana/kit";

import { createState } from '../utils/index.js';
import { JobState } from "../../../src/types/index.js";
import { checkAllJobsStopped, checkDeploymentsJobs, checkSufficientVaultBalance, createDeployment, startDeployment, stopDeployment, stopJob, waitForDeploymentStatus, waitForSeconds } from '../common/index.js';
import {vaultAddress} from "../setup.js";

describe('Simple Deployment Strategy', () => {
  const deployment = createState<Deployment>();
  const firstJob = createState<string>();

  afterAll(async () => {
    const vault = deployment.get().vault;
    await vault.withdraw()
  });

  it('creates deployment with SIMPLE strategy', async () => {
    await createDeployment(
      deployment,
      {
        strategy: DeploymentStrategy.SIMPLE,
        // @ts-ignore
        vault: vaultAddress,
      },
    )();
  });

  it('tops up vault', async () => {
    const vault = deployment.get().vault;
    const nosValue = 0.5;
    const solValue = 0.015;
    await vault.topup({ SOL: solValue, NOS: nosValue })
    const balance = await vault.getBalance();

    expect(balance.NOS).toBeGreaterThanOrEqual(nosValue);
    expect(balance.SOL).toBeGreaterThanOrEqual(solValue);
  });

  it('check vault has sufficient funds', checkSufficientVaultBalance(deployment));

  it('start deployment', startDeployment(deployment));

  it('wait for deployment to be running', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.RUNNING }));

  it('wait for first job to be posted', checkDeploymentsJobs(
    deployment,
    { expectedJobsCount: 1 },
    ({ jobs }) => firstJob.set(jobs[0].job)
  ));

  it('wait 10 seconds to allow job to run', waitForSeconds(10));

  it('stops deployment and all jobs', stopDeployment(deployment));

  it('wait for deployment to be stopped', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.STOPPED }));

  it('check all jobs are stopped', checkAllJobsStopped(deployment));

  it('restart deployment', startDeployment(deployment));

  it('wait for deployment to be running', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.RUNNING }));

  it('wait for first job to be posted', checkDeploymentsJobs(
    deployment,
    { expectedJobsCount: 2 },
    ({ jobs }) => {
      // @ts-expect-error Job state is not yet reflected in kit types
      expect(jobs.some((job) => job.state !== JobState.STOPPED)).toBeTruthy();
    }
  ));

  it('wait 10 seconds to allow job to run', waitForSeconds(10));

  it('stop new job prematurely', stopJob(() => deployment.get().jobs.find(({ job }) => job !== firstJob.get())!.job));

  it('wait for deployment to be stopped', waitForDeploymentStatus(
    deployment, { expectedStatus: DeploymentStatus.STOPPED },
    // @ts-expect-error Job state is not yet reflected in kit types
    ({ jobs }) => expect(jobs.every(({ state }) => state === JobState.STOPPED)).toBe(true)
  ));
});