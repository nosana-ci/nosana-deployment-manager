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
   ├──/__mock/* (queue, plan, calls)──▶ host-manager mock :3006 ◀──/reservations/requests──┤
   │                                         └──authed webhook──▶ /webhooks/reservations──┤
   │                                                                          │
   └──chain ops──▶ localnet validator :8899/:8900 ◀──rpc/ws (host.docker.internal)──┘
                            ▲
                            DM workers (docker) assign/stop/extend jobs
```

- The kit calls `${BACKEND_URL}/api/deployments/...`; the DM serves `/deployments/...`.
  `apiPrefixProxy.ts` strips the `/api` prefix (mirrors the prod ingress).
- The DM runs in Docker, so it reaches the host validator via
  `host.docker.internal` (`SOLANA_NETWORK` / `SOLANA_WS_NETWORK`).
- Every LIST requests nodes from host-manager and assigns the jobs to them, so a
  job is only posted once a node is in the market queue. The suite never talks
  to a real host-manager: `mocks/hostManagerMock.ts` serves
  `POST /reservations/requests` and `DELETE /reservations/requests/:key`, started
  for the whole run by vitest's `globalSetup` on port 3006 (`HOST_MANAGER_URL` /
  `HOST_MANAGER_API_KEY` in `compose.yaml` point the DM at it).
  `joinMarketQueue` tells the mock the node is queued; a waiting request takes
  it and the mock calls the DM's webhook, authenticated with the shared key, at
  `DEPLOYMENT_MANAGER_WEBHOOK_URL` (default `http://localhost:3001/webhooks/reservations`).
  A handed-out node leaves its queue like an assigned node leaves the chain's,
  the same key (a LIST task's id) renews or replays a request, and flows can script responses
  (`planReservations`: a node that is not queued, a short hold, a 503/409/422; a key reused with other terms gets a 409),
  fill or silence webhooks (`hostManagerMock.fulfil`, `hostManagerMock.webhooks`)
  and inspect what the DM did (`waitForReservations`, `requestingTasks`,
  `hostManagerMock.cancels`, `hostManagerMock.deliveries`).

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

# 3. the /api-prefix proxy (background; the host-manager mock starts with the run)
npm run scenario:proxy &

# 4. the scenarios (localnet is the default network)
BACKEND_URL=http://localhost:3002 npm run test:scenarios            # all
BACKEND_URL=http://localhost:3002 npm run test:scenarios -- simple  # one scenario
BACKEND_URL=http://localhost:3002 npm run test:scenarios -- simple-extend basic-flow
# the reservation flows retry after the DM cooldown and missed-webhook waits for a renewal;
# run the DM with RETRY_COOLDOWN_BASE_MS=2000 RESERVATION_RENEW_MS=10000 for a fast pass
BACKEND_URL=http://localhost:3002 npm run test:scenarios -- reservations

# teardown
docker compose down -v
npm run localnet:down
```

The setup helper airdrops SOL, mints NOS, ensures a stake account, and creates a
fresh market per test file — no funded wallet or shared market needed.
