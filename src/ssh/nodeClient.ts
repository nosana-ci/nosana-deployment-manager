import { getConfig } from "../config/index.js";
import { messageOf } from "../tasks/idempotency/errorInfo.js";

/** Per-node budget; a dead node must not hold the whole rotation hostage. */
export const NODE_REQUEST_TIMEOUT_MS = 10_000;

/** First line of the signed authorization message; the node rejects any other. */
export const SSH_AUTHORIZATION_MESSAGE_HEADER = "Nosana SSH Authorization v1";
export const SSH_AUTHORIZATION_AUDIENCE = "nosana-ssh-gateway";

/** A node's public API base URL, fronted by FRPS like the deployment endpoints. */
export function getNodeUrl(node: string): string {
  return `https://${node}.${getConfig().frps_public_address}`;
}

/**
 * Signs an authorization message as the job's poster; returns the untouched
 * `kit.authorization.generate` output — `<message>:<base58 signature>` — which
 * the node verifies as-is.
 */
export type SignSshAuthorizationMessage = (message: string) => Promise<string>;

export type NodeSshKeysResult = { ok: true } | { ok: false; error: string };

/**
 * The exact message text the node's `POST /job/:jobId/ssh/authorize` verifies
 * (see the node's `ssh-authorize.ts`): field order, the `nosana-<job>` ssh user
 * and the audience must match verbatim. The `network` line is included only for
 * networks a node can be configured with; when absent (localnet) the node
 * skips that check.
 */
export function buildSshAuthorizationMessage(args: {
  job: string;
  node: string;
  sshPublicKey: string;
}): string {
  const { network } = getConfig();
  return [
    SSH_AUTHORIZATION_MESSAGE_HEADER,
    "",
    `job: ${args.job}`,
    `node: ${args.node}`,
    `sshUser: nosana-${args.job}`,
    `sshPublicKey: ${args.sshPublicKey}`,
    ...(network === "mainnet" || network === "devnet" ? [`network: ${network}`] : []),
    `audience: ${SSH_AUTHORIZATION_AUDIENCE}`,
  ].join("\n");
}

/**
 * Grant every key in the set SSH access to one running job. The node's only
 * SSH route is `POST /job/:jobId/ssh/authorize` — one key per call, each
 * carrying a message signed by the job's poster (the deployment's vault),
 * verified against `job.project`. Never throws — the caller reports per-job
 * outcomes, it doesn't abort the rotation because one node is unreachable.
 */
export async function pushSshKeysToNode(args: {
  node: string;
  job: string;
  public_keys: string[];
  sign: SignSshAuthorizationMessage;
}): Promise<NodeSshKeysResult> {
  const { node, job, public_keys, sign } = args;

  const failures: string[] = [];
  for (const [index, sshPublicKey] of public_keys.entries()) {
    const failure = await authorizeSshKey({ node, job, sshPublicKey, sign });
    if (failure) failures.push(`public_keys[${index}]: ${failure}`);
  }

  return failures.length === 0 ? { ok: true } : { ok: false, error: failures.join("; ") };
}

/** One authorize call; returns the failure reason, undefined on success. */
async function authorizeSshKey(args: {
  node: string;
  job: string;
  sshPublicKey: string;
  sign: SignSshAuthorizationMessage;
}): Promise<string | undefined> {
  const { node, job, sshPublicKey, sign } = args;

  try {
    const message = buildSshAuthorizationMessage({ job, node, sshPublicKey });
    // The message is multiline, so the signed string can't travel as an HTTP
    // header; the node reads it from the body and verifies it unmodified.
    const authorization = await sign(message);

    const response = await fetch(`${getNodeUrl(node)}/job/${job}/ssh/authorize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ authorization }),
      signal: AbortSignal.timeout(NODE_REQUEST_TIMEOUT_MS),
    });

    if (response.ok) return undefined;

    const body = await response.text().catch(() => "");
    return body ? `${response.status}: ${body.slice(0, 300)}` : `${response.status}`;
  } catch (error) {
    return messageOf(error);
  }
}
