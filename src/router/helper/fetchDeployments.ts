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
      $lookup: {
        from: "events",
        localField: "id",
        foreignField: "deploymentId",
        as: "events",
      },
    },
    {
      $lookup: {
        from: "jobs",
        localField: "id",
        foreignField: "deployment",
        as: "jobs",
      },
    },
    {
      $lookup: {
        from: "revisions",
        localField: "id",
        foreignField: "deployment",
        as: "revisions",
      },
    },
    {
      $addFields: {
        events: { $sortArray: { input: "$events", sortBy: { created_at: -1 } } },
        jobs: { $sortArray: { input: "$jobs", sortBy: { created_at: -1 } } },
        revisions: { $sortArray: { input: "$revisions", sortBy: { revision: -1 } } },
      },
    },
    {
      $project: {
        _id: false,
        "revisions._id": false,
        "events._id": false,
        "jobs._id": false,
        "jobs.run": false,
      },
    },
  ];

  const deployment = await deployments.aggregate(pipeline).toArray();
  return deployment as DeploymentAggregation[];
}
