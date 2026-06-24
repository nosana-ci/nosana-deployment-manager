// Minimal dependency-free reverse proxy that strips the leading `/api` segment
// and forwards to the local deployment-manager API. The kit's `@nosana/api`
// client calls `${BACKEND_URL}/api/deployments/...`, but the DM registers those
// routes under `/deployments/...` (API_PREFIX, no `/api`). In production an
// ingress strips `/api`; this proxy mirrors that for local scenario runs.
//
// Usage:  node testing/scenario/api-prefix-proxy.mjs
//   LISTEN_PORT (default 3002) -> TARGET_HOST:TARGET_PORT (default localhost:3001)
// Then point the suite at it:  BACKEND_URL=http://localhost:3002
import http from "http";

const TARGET_HOST = process.env.TARGET_HOST || "localhost";
const TARGET_PORT = Number(process.env.TARGET_PORT || 3001);
const LISTEN_PORT = Number(process.env.LISTEN_PORT || 3002);

const server = http.createServer((req, res) => {
  let path = req.url || "/";
  if (path === "/api" || path === "/api/") path = "/";
  else if (path.startsWith("/api/")) path = path.slice(4); // drop "/api"

  const proxyReq = http.request(
    {
      host: TARGET_HOST,
      port: TARGET_PORT,
      method: req.method,
      path,
      headers: { ...req.headers, host: `${TARGET_HOST}:${TARGET_PORT}` },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );
  proxyReq.on("error", (err) => {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "proxy_error", message: err.message }));
  });
  req.pipe(proxyReq);
});

server.listen(LISTEN_PORT, () =>
  console.log(
    `[api-prefix-proxy] listening on ${LISTEN_PORT} -> ${TARGET_HOST}:${TARGET_PORT} (strips leading /api)`
  )
);
