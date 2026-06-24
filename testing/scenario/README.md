# Scenario tests

End-to-end tests that drive the **local** deployment-manager (DM) through real
deployment lifecycles (LIST / STOP / EXTEND) against a Solana validator.

By default they run against **localnet** (`@nosana/localnet`): a Docker validator
with Nosana programs pre-baked — no RPC throttling, no indexer lag, matched
program versions, and a dedicated market per run. Set `NOSANA_NETWORK=devnet`
(plus `TEST_DEPLOYER_KEY_PATH`/`TEST_NODE_KEY_PATH` to a funded keypair) to run
against devnet instead.

## Topology

```
vitest (host) ──HTTP /api/deployments/*──▶ proxy :3002 ──/deployments/*──▶ DM api :3001
   │                                                                          │
   └──chain ops──▶ localnet validator :8899/:8900 ◀──rpc/ws (host.docker.internal)──┘
                            ▲
                            DM workers (docker) post/stop/extend jobs
```

- The kit calls `${BACKEND_URL}/api/deployments/...`; the DM serves `/deployments/...`.
  `api-prefix-proxy.mjs` strips the `/api` prefix (mirrors the prod ingress).
- The DM runs in Docker, so it reaches the host validator via
  `host.docker.internal` (`SOLANA_NETWORK` / `SOLANA_WS_NETWORK`).

## Run (localnet)

```bash
# 1. validator with Nosana programs
npm run localnet:up

# 2. the DM stack, pointed at the validator
NETWORK=localnet \
SOLANA_NETWORK=http://host.docker.internal:8899 \
SOLANA_WS_NETWORK=ws://host.docker.internal:8900 \
VAULT_KEY=change_me \
docker compose up -d --wait

# 3. the /api-prefix proxy (background)
npm run scenario:proxy &

# 4. the scenarios (localnet is the default network)
BACKEND_URL=http://localhost:3002 npm run test:scenarios            # all
BACKEND_URL=http://localhost:3002 npm run test:scenarios -- simple  # one scenario
BACKEND_URL=http://localhost:3002 npm run test:scenarios -- simple-extend basic-flow

# teardown
docker compose down -v
npm run localnet:down
```

The setup helper airdrops SOL, mints NOS, ensures a stake account, and creates a
fresh market per test file — no funded wallet or shared market needed.
