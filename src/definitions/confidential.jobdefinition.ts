import { JobDefinition } from "@nosana/kit";

import { getConfig } from "../config/index.js";

export const createConfidentialJobDefinition = (): JobDefinition => {
  const { base_url } = getConfig();
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
          "endpoint": `${base_url}/api/deployments/jobs/%%global.job%%/job-definition`
        }
      },
      "receive": {
        "type": "api",
        "args": {
          "endpoint": `${base_url}/api/deployments/jobs/%%global.job%%/results`
        }
      }
    },
    "ops": []
  }
}