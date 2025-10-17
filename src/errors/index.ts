export function errorFormatter(
  customMessage: string,
  errorObject: { error: string } | undefined
) {
  if (errorObject?.error) {
    throw new Error(`${customMessage}: ${errorObject.error}`);
  }
  throw new Error(customMessage);
}

export const ErrorMessages = {
  generic: {
    INVALID_BODY: "Invalid request body.",
    SOMETHING_WENT_WRONG: "Ops something went wrong, please again.",
  },
  deployments: {
    NOT_FOUND: "Deployment not found.",
    ARCHIVED: "Cannot modify an archived deployment.",
    INCORRECT_STATE: "Deployment is in the incorrect state.",
    INCORRECT_STRATEGY: "Deployment is using an incorrect strategy.",
    FAILED_TO_UPDATE_SCHEDULE: "Failed to update deployment schedule.",
    FAILED_STARTING: "Failed to start deployment.",
    FAILED_TO_STOP: "Failed to stop deployment.",
    FAILED_TO_ARCHIVE: "Failed to archive deployment.",
    FAILED_TIMEOUT_UPDATE: "Failed to update deployment timeout.",
    FAILED_REPLICA_COUNT_UPDATE: "Failed to update deployment replica count",
    INVALID_ACTIVE_REVISION: "The specified revision does not exist.",
    FAILED_TO_UPDATE_ACTIVE_REVISION: "Failed to update deployment active revision.",
    FAILED_TO_CREATE_NEW_REVISION: "Failed to create a new deployment revision.",
  },
  job: {
    NOT_FOUND: "Job not found.",
    JOB_RESULTS_NOT_FOUND: "Job results not found",
    JOB_NOT_COMPLETED: "This job has not yet completed",
    JOB_ALREADY_COMPLETED: "Job has already been completed.",
    FAILED_TO_SAVE_RESLTS: "Failed to save the jobs results.",
    FAILED_TO_FIND_JOB_DEFINITION: "Failed to find the jobs definition.",
    FAILED_TO_FIND_DEPLOYMENT: "Failed to find the deployments job definition.",
  },
  vaults: {
    NOT_FOUND: "Vault not found.",
    NOT_EMPTY: "Vault must be empty. Please withdraw all funds.",
    FAILED_TO_ARCHIVE: "Failed to archive vault.",
    FAILED_TO_FIND_KEY: "Could not find vault.",
    FAILED_TO_UPDATE_BALANCE: "Could not update vaults balance.",
  },
};
