import {
  DeploymentAggregation,
  DeploymentCollection,
  EventDocument,
  JobsDocument,
  RevisionDocument,
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
      $project: {
        _id: false,
        "revisions._id": false,
        "events._id": false,
        "jobs._id": false,
        "jobs.run": false,
      },
    },
  ];

  const deployment = await deployments.aggregate<DeploymentAggregation>(pipeline).toArray();

  return deployment.map((deployment) => {
    const sortByDateDesc = (a: EventDocument | JobsDocument, b: EventDocument | JobsDocument) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime();

    const sortRevisionsDesc = (a: RevisionDocument, b: RevisionDocument) => {
      const ra = typeof a?.revision === "number" ? a.revision : parseInt(String(a?.revision || ""), 10) || 0;
      const rb = typeof b?.revision === "number" ? b.revision : parseInt(String(b?.revision || ""), 10) || 0;
      return rb - ra;
    };

    deployment.events.sort(sortByDateDesc);
    deployment.jobs.sort(sortByDateDesc);
    deployment.revisions.sort(sortRevisionsDesc);
    return deployment;
  });
}
