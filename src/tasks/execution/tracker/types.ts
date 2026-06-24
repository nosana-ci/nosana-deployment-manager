export type TrackOutcome = "CONFIRMED" | "EXPIRED" | "ERROR" | "ABORTED";
export type TrackResult = { outcome: TrackOutcome; error?: string };

/** One `getSignatureStatuses` value (or null/undefined when not found). */
export type SignatureStatusValue = { confirmationStatus?: string | null; err?: unknown } | null;

/** A signature awaiting confirm/expire, plus how to resolve and clean it up. */
export type Entry = {
  lastValidBlockHeight: number;
  resolve: (result: TrackResult) => void;
  cleanup?: () => void;
};
