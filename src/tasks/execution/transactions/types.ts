export type UnitOutcome =
  | { result: "CONFIRMED"; signature: string }
  | { result: "EXPIRED"; signature?: string }
  | { result: "ERROR"; signature?: string; error: string }
  | { result: "ABORTED"; signature?: string };

/** What a resumed record needs next: a terminal outcome, or a re-broadcast. */
export type RecoveryAction =
  | { kind: "OUTCOME"; outcome: UnitOutcome }
  | { kind: "RESEND" };
