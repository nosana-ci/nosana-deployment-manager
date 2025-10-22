import {
  DeploymentAggregation,
  DeploymentCollection,
} from "../../types/index.js";

export async function fetchDeployments(
  {
    id,
    owner,
  }: {
    id?: string | undefined;
    owner: string;
  },
  deployments: DeploymentCollection
): Promise<DeploymentAggregation[]> {
  const deployment = await deployments
    .aggregate()
    .match({
      ...(id
        ? {
          id: {
            $eq: id,
          },
        }
        : {}),
      owner: {
        $eq: owner,
      },
    })
    .lookup({
      from: "events",
      localField: "id",
      foreignField: "deploymentId",
      as: "events",
    })
    .lookup({
      from: "jobs",
      localField: "id",
      foreignField: "deployment",
      as: "jobs",
    })
    .lookup({
      from: "revisions",
      localField: "id",
      foreignField: "deployment",
      as: "revisions",
    })
    .project({
      _id: false,
      "revisions._id": false,
      "events._id": false,
      "jobs._id": false,
      "jobs.run": false,
    })
    .toArray();

  return deployment as DeploymentAggregation[];
}
