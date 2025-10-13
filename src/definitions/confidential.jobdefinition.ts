import { JobDefinition } from "@nosana/sdk";

export const confidentialJobDefinition: JobDefinition = {
  version: '0.1',
  type: 'container',
  meta: {
    trigger: 'cli',
  },
  logistics: {
    send: {
      type: 'api-listen',
      args: {},
    },
    receive: {
      type: 'api-listen',
      args: {},
    },
  },
  ops: [],
}