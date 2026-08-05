import { Collection, ObjectId } from "mongodb";

import {
  DeploymentsRepository,
  JobsRepository,
  RevisionsRepository,
  VaultsRepository,
} from "../../../repositories/index.js";
import {
  JobState,
  JobsDocument,
  OutstandingTasksDocument,
  RevisionDocument,
  TaskDocument,
} from "../../../types/index.js";

/**
 * Hydrate claimed tasks with their deployment, vault, jobs and revisions for
 * the worker. A task whose deployment or vault no longer exists is dropped (it
 * cannot be acted on); it stays PROCESSING until its lease lapses and is then
 * reclaimed, eventually hitting the crash-loop cap.
 *
 * Hydration is separate filtered queries stitched in memory, NOT $lookups: the
 * unfiltered lookup embedded the deployment's full job history and every
 * revision's job_definition into one task document, which can exceed the 16MB
 * reply cap, and DocumentDB does not support the pipeline form of $lookup that
 * would trim it server-side. Only QUEUED/RUNNING jobs are fetched, and
 * revisions are projected down to their metadata (no job_definition).
 */
export async function enrichClaimedTasks(
  collection: Collection<TaskDocument>,
  ids: ObjectId[]
): Promise<OutstandingTasksDocument[]> {
  if (ids.length === 0) return [];

  const tasks = await collection.find({ _id: { $in: ids } }).toArray();
  if (tasks.length === 0) return [];

  const deploymentIds = [...new Set(tasks.map((task) => task.deploymentId))];

  const [deployments, jobs, revisions] = await Promise.all([
    DeploymentsRepository.findAll({ id: { $in: deploymentIds } }),
    JobsRepository.findAll({
      deployment: { $in: deploymentIds },
      state: { $in: [JobState.QUEUED, JobState.RUNNING] },
    }),
    RevisionsRepository.findAll(
      { deployment: { $in: deploymentIds } },
      { projection: { job_definition: 0 } }
    ),
  ]);

  const vaults = await VaultsRepository.findAll({
    vault: { $in: [...new Set(deployments.map((deployment) => deployment.vault))] },
  });

  const deploymentById = new Map(deployments.map((deployment) => [deployment.id, deployment]));
  const vaultByKey = new Map(vaults.map((vault) => [vault.vault, vault]));

  const jobsByDeployment = new Map<string, JobsDocument[]>();
  for (const job of jobs) {
    const bucket = jobsByDeployment.get(job.deployment);
    if (bucket) bucket.push(job);
    else jobsByDeployment.set(job.deployment, [job]);
  }

  const revisionsByDeployment = new Map<string, Omit<RevisionDocument, "job_definition">[]>();
  for (const revision of revisions) {
    const bucket = revisionsByDeployment.get(revision.deployment);
    if (bucket) bucket.push(revision);
    else revisionsByDeployment.set(revision.deployment, [revision]);
  }

  const enriched: OutstandingTasksDocument[] = [];
  for (const task of tasks) {
    const deployment = deploymentById.get(task.deploymentId);
    if (!deployment) continue;

    const vault = vaultByKey.get(deployment.vault);
    if (!vault) continue;

    enriched.push({
      ...task,
      deployment: { ...deployment, vault },
      jobs: jobsByDeployment.get(task.deploymentId) ?? [],
      revisions: revisionsByDeployment.get(task.deploymentId) ?? [],
    });
  }

  return enriched;
}
