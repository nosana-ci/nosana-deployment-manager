import { expect } from 'vitest';
import { Deployment } from '@nosana/api';
import { DeploymentStatus, DeploymentStrategy } from '@nosana/kit';

import { createState, createFlow } from '../../utils/index.js';
import {
  checkAllJobsStopped,
  checkDeploymentJobs,
  checkSufficientVaultBalance,
  createDeployment,
  joinMarketQueue,
  startDeployment,
  stopDeployment,
  waitForDeploymentStatus,
} from '../../common/index.js';
import { apiClient } from '../../setup.js';

/** Job detail is served from our own record and the chain; nothing else is needed. */
const PLACEHOLDER_NODE = '11111111111111111111111111111111';

const getJobDetail = async (deployment: string, job: string) => {
  const { data, response } = await apiClient.GET('/api/deployments/{deployment}/jobs/{job}', {
    params: { path: { deployment, job } },
  });
  expect(response.status).toBe(200);
  return data!;
};

createFlow('Job Detail Lifecycle', (step) => {
  const deployment = createState<Deployment>();
  const firstJob = createState<string>();

  step('creates deployment with SIMPLE strategy', createDeployment(
    deployment,
    {
      name: 'Scenario testing: simple > job detail lifecycle',
      strategy: DeploymentStrategy.SIMPLE,
    },
  ));

  step('check vault has sufficient funds', checkSufficientVaultBalance(deployment));

  step('join market queue so the job is claimed', joinMarketQueue(() => deployment.get().market));

  step('start deployment', startDeployment(deployment));

  step('wait for deployment to be running', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.RUNNING }));

  step('wait for the job to be posted', checkDeploymentJobs(
    deployment,
    { expectedJobsCount: 1 },
    ({ jobs }) => firstJob.set(jobs[0].job)
  ));

  step('job detail reports the claim: RUNNING, the claiming node, a start time', async () => {
    await expect.poll(
      async () => (await getJobDetail(deployment.get().id, firstJob.get())).state,
      { message: 'waiting for the job to be claimed' }
    ).toBe(1);

    const detail = await getJobDetail(deployment.get().id, firstJob.get());
    expect(detail.node, 'the claiming node, not the placeholder').not.toBe(PLACEHOLDER_NODE);
    expect(detail.timeStart).toBeGreaterThan(0);
    expect(detail.listedAt).toBeGreaterThan(0);
  });

  step('job detail agrees with the jobs list', async () => {
    const { data } = await apiClient.GET('/api/deployments/{deployment}/jobs', {
      params: { path: { deployment: deployment.get().id } },
    });
    const listed = data!.jobs.find((job) => job.job === firstJob.get())!;
    const detail = await getJobDetail(deployment.get().id, firstJob.get());

    expect(detail.state).toBe(1);
    expect(listed.state).toBe('RUNNING');
    expect(detail.node).toBe(listed.node);
  });

  step('stop deployment', stopDeployment(deployment));

  step('wait for deployment to be stopped', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.STOPPED }));

  step('check if all jobs are stopped', checkAllJobsStopped(deployment));

  step('job detail reports the job as finished', async () => {
    const detail = await getJobDetail(deployment.get().id, firstJob.get());
    expect(detail.state).toBeGreaterThan(1);
  });
});
