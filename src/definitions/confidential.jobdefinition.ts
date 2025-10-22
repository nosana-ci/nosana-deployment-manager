import { JobDefinition } from "@nosana/sdk";

import { getConfig } from "../config/index.js";

export const createConfidentialJobDefinition = (): JobDefinition => {
  const { address } = getConfig();
  return {
    "version": "0.1",
    "type": "container",
    "meta": {
      "trigger": "cli"
    },
    "logistics": {
      "send": {
        "type": "api",
        "args": {
          "endpoint": `${address}/api/deployments/jobs/%%global.job%%/job-definition`
        }
      },
      "receive": {
        "type": "api",
        "args": {
          "endpoint": `${address}/api/deployments/jobs/%%global.job%%/results`
        }
      }
    },
    "ops": []
  }
}