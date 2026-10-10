import { expect } from 'vitest';
import { Deployment, JobDefinition, NosanaApi } from '@nosana/api';
import { DeploymentStatus, DeploymentStrategy } from '@nosana/kit';

import { createFlow, createState } from '../../utils/index.js';
import { createSimpleDeploymentBody } from '../../utils/deploymentBody.js';
import {
  checkAllJobsStopped,
  checkDeploymentJobs,
  createDeployment,
  deleteDeployment,
  joinMarketQueue,
  startDeployment,
  stopDeployment,
  waitForDeploymentHasNoTasks,
  waitForDeploymentStatus,
  waitForSeconds,
} from '../../common/index.js';
import { deployerClient } from '../../setup.js';

// A revision change no longer schedules work on a deployment that is not meant
// to be running: the swap's LIST is dropped when it comes due (nothing is
// posted, the deployment stays STOPPED), and revisions are numbered after the
// highest one there is, so creating one after a rollback no longer collides.
createFlow('Revision on a stopped deployment', (step) => {
  const deployment = createState<Deployment>();
  const definition = (createSimpleDeploymentBody().job_definition as JobDefinition);
  const refresh = async () =>
    deployment.set(await (deployerClient.api as NosanaApi).deployments.get(deployment.get().id));

  step('creates deployment with SIMPLE strategy', createDeployment(deployment, {
    name: 'Scenario testing: simple > revision on stopped',
    strategy: DeploymentStrategy.SIMPLE,
  }));

  step('join market queue before starting deployment', joinMarketQueue(() => deployment.get().market));

  step('start deployment', startDeployment(deployment));

  step('wait for deployment to be running', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.RUNNING }));

  step('wait for the job to be posted', checkDeploymentJobs(deployment, { expectedJobsCount: 1 }));

  step('stop deployment', stopDeployment(deployment));

  step('wait for deployment to be stopped', waitForDeploymentStatus(deployment, { expectedStatus: DeploymentStatus.STOPPED }));

  step('check if all jobs are stopped', checkAllJobsStopped(deployment));

  step('create revision 2 while stopped', async () => {
    await deployment.get().createRevision(definition);
    await refresh();
    expect(deployment.get().active_revision).toBe(2);
  });

  step('its tasks are dropped when due', waitForDeploymentHasNoTasks(deployment));

  step('give a stray LIST time to post', waitForSeconds(5));

  step('nothing was posted and the deployment is still stopped', async () => {
    const { jobs } = await deployment.get().getJobs();
    expect(jobs).toHaveLength(1);
    await refresh();
    expect(deployment.get().status).toBe(DeploymentStatus.STOPPED);
  });

  step('roll back to revision 1', async () => {
    await deployment.get().updateActiveRevision(1);
    await refresh();
    expect(deployment.get().active_revision).toBe(1);
  });

  step('a new revision after the rollback is numbered 3', async () => {
    await deployment.get().createRevision(definition);
    await refresh();
    expect(deployment.get().active_revision).toBe(3);
    const { revisions } = await deployment.get().getRevisions();
    expect(revisions.map(({ revision }) => revision).sort()).toEqual([1, 2, 3]);
  });

  step('wait for its tasks to be dropped too', waitForDeploymentHasNoTasks(deployment));

  step('delete deployment', deleteDeployment(deployment));
});
