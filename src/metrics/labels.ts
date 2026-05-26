/** The URL path for the Prometheus metrics endpoint. */
export const METRICS_ROUTE_PATH = "/metrics";

/** Minimum length of a Solana base58 public key. */
const MIN_PUBKEY_LENGTH = 32;

/** Maximum length of a Solana base58 public key. */
const MAX_PUBKEY_LENGTH = 44;

/**
 * Extracts a route pattern from a raw URL pathname by replacing dynamic
 * segments (numeric IDs, Solana addresses, invitation tokens) with named
 * placeholders, preventing high-cardinality label values in Prometheus.
 *
 * Fixes the regex bug present in dashboard-backend's httpMetricsMiddleware.ts
 * line 44: `/^\\d+$/` was matching the literal string `\d+`, never digits.
 * This version correctly uses `/^\d+$/`.
 */
export function extractRoutePattern(pathname: string): string {
  const cleanPath = pathname.split("?")[0];

  const normalizedPath =
    cleanPath.endsWith("/") && cleanPath.length > 1
      ? cleanPath.slice(0, -1)
      : cleanPath;

  const segments = normalizedPath.split("/");

  const processedSegments = segments.map((segment) => {
    if (!segment) return segment;

    // Numeric ID — fix: use /^\d+$/ not /^\\d+$/ (the latter matches literal backslash-d)
    if (/^\d+$/.test(segment)) {
      return ":id";
    }

    // 64-char alphanumeric invitation token
    if (segment.length === 64 && /^[a-zA-Z0-9]+$/.test(segment)) {
      return ":invitation-token";
    }

    // Solana base58 public key (32–44 chars, alphanumeric)
    if (
      segment.length >= MIN_PUBKEY_LENGTH &&
      segment.length <= MAX_PUBKEY_LENGTH &&
      /^[a-zA-Z0-9]+$/.test(segment)
    ) {
      return ":address";
    }

    return segment;
  });

  return processedSegments.join("/");
}

export type StatusRange = "1xx" | "2xx" | "3xx" | "4xx" | "5xx";

/**
 * Maps an HTTP status code to its range bucket string for Prometheus labels.
 */
export function statusRange(code: number): StatusRange {
  if (code >= 500) return "5xx";
  if (code >= 400) return "4xx";
  if (code >= 300) return "3xx";
  if (code >= 200) return "2xx";
  return "1xx";
}
