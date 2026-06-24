import { isNosanaApiError } from "@nosana/kit";

/** Human-readable one-liner for a thrown error, for fatal surfacing / logging. */
export function messageOf(error: unknown): string {
  if (error instanceof Error) return `${error.name} ${error.message}`;
  return typeof error === "object" ? JSON.stringify(error) : String(error);
}

/**
 * The CM surfaces an `IN_PROGRESS` backoff hint on `err.retryAfter` — already
 * parsed by the kit to a number of seconds (it handles both delta-seconds and
 * HTTP-date `Retry-After` forms). Convert it to ms for the in-flight reschedule;
 * absent/negative → undefined so the caller falls back to its default.
 */
export function retryAfterMsOf(error: unknown): number | undefined {
  if (!isNosanaApiError(error)) return undefined;
  const seconds = error.retryAfter;
  return seconds != null && Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}
