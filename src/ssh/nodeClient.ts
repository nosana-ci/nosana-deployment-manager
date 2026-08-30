import { getConfig } from "../config/index.js";
import { messageOf } from "../tasks/idempotency/errorInfo.js";

/** Per-node budget; a dead node must not hold the whole rotation hostage. */
export const NODE_REQUEST_TIMEOUT_MS = 10_000;

/** A node's public API base URL, fronted by FRPS like the deployment endpoints. */
export function getNodeUrl(node: string): string {
  return `https://${node}.${getConfig().frps_public_address}`;
}

export type NodeSshKeysResult = { ok: true } | { ok: false; error: string };

/**
 * Grant every key in the set SSH access to one running job. The node's only
 * SSH route is `POST /job/:jobId/ssh/authorize` — one key per call. The request
 * is authenticated by the standard job-owner `authorization` header, which the
 * node verifies against `job.project`; the body only names the key to add. The
 * node derives everything else itself: the node id from the request host and
 * the job from the route param. Never throws — the caller reports per-job
 * outcomes, it doesn't abort the rotation because one node is unreachable.
 */
export async function pushSshKeysToNode(args: {
  node: string;
  job: string;
  public_keys: string[];
  authHeader: string;
}): Promise<NodeSshKeysResult> {
  const { node, job, public_keys, authHeader } = args;

  const failures: string[] = [];
  for (const [index, sshPublicKey] of public_keys.entries()) {
    const failure = await authorizeSshKey({ node, job, sshPublicKey, authHeader });
    if (failure) failures.push(`public_keys[${index}]: ${failure}`);
  }

  return failures.length === 0 ? { ok: true } : { ok: false, error: failures.join("; ") };
}

/** One authorize call; returns the failure reason, undefined on success. */
async function authorizeSshKey(args: {
  node: string;
  job: string;
  sshPublicKey: string;
  authHeader: string;
}): Promise<string | undefined> {
  const { node, job, sshPublicKey, authHeader } = args;

  try {
    const response = await fetch(`${getNodeUrl(node)}/job/${job}/ssh/authorize`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: authHeader },
      body: JSON.stringify({ sshPublicKey }),
      signal: AbortSignal.timeout(NODE_REQUEST_TIMEOUT_MS),
    });

    if (response.ok) return undefined;

    const body = await response.text().catch(() => "");
    return body ? `${response.status}: ${body.slice(0, 300)}` : `${response.status}`;
  } catch (error) {
    return messageOf(error);
  }
}
