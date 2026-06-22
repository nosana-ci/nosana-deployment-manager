export type UnitOutcome =
  | { result: "CONFIRMED"; signature: string; jobCount?: number }
  | { result: "EXPIRED"; signature?: string }
  | { result: "ERROR"; signature?: string; error: string }
  | { result: "ABORTED"; signature?: string }
  // API-key path: in-flight / no definitive response. Non-terminal — the task is
  // rescheduled (not a crash) and re-issues the same idempotency key (CM de-dupes).
  // `retryAfterMs` is the CM's `Retry-After` backoff hint, when provided.
  | { result: "RETRY"; retryAfterMs?: number };

/** What a resumed record needs next: a terminal outcome, or a re-broadcast. */
export type RecoveryAction =
  | { kind: "OUTCOME"; outcome: UnitOutcome }
  | { kind: "RESEND" };
