import { Collection } from "mongodb";

import { JobState } from "../../../../types/index.js";
import type { JobsCollection, OutstandingTasksDocument } from "../../../../types/index.js";

export function onStopExit(
  stoppedJobs: string[],
  jobsCollection: Collection<JobsCollection>,
  { active_revision }: OutstandingTasksDocument
) {
  jobsCollection.updateMany(
    {
      job: { $in: stoppedJobs },
      revision: { $ne: active_revision },
    },
    {
      $set: {
        state: JobState.STOPPED,
      },
    }
  );
}
