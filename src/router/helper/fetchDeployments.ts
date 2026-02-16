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
  const pipeline = [
    {
      $match: {
        ...(id ? { id: { $eq: id } } : {}),
        owner: { $eq: owner },
      },
    },
    { $sort: { created_at: -1 } },
    {
      $project: {
        _id: false,
      },
    },
  ];

  const deployment = await deployments.aggregate<DeploymentAggregation>(pipeline).toArray();

  return deployment;
}
