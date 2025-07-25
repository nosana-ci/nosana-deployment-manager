import { DeploymentAggregation, DeploymentCollection } from "../../types.js";

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
  console.log({
    id,
    owner,
  });
  console.log(await deployments.aggregate().toArray());
  console.log({ id, owner });

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
    .project({
      _id: false,
      "events._id": false,
      "jobs._id": false,
      "jobs.run": false,
    })
    .toArray();

  return deployment as DeploymentAggregation[];
}
