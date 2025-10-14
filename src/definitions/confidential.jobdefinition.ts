import { JobDefinition } from "@nosana/sdk";

export const confidentialJobDefinition: JobDefinition = {
  "version": "0.1",
  "type": "container",
  "meta": {
    "trigger": "cli"
  },
  "logistics": {
    "send": {
      "type": "api",
      "args": {
        "endpoint": "http://localhost:3000/api/jobs/%%global.job%%/job-definition"
      }
    },
    "receive": {
      "type": "api-listen",
      "args": {}
    }
  },
  "ops": []
}