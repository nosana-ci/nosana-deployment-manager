import { getConfig } from "../../config/index.js";

/** An escalating-backoff ladder: `min(baseMs · multiplier^n, maxMs)`. */
export type CooldownLadder = {
  baseMs: number;
  maxMs: number;
  multiplier: number;
};

/**
 * Cooldown for the `n`-th retry (0-indexed: `n = 0` is the first retry → `baseMs`).
 * Pure and deterministic so the backoff math can be unit-tested without config.
 */
export function computeCooldown(n: number, ladder: CooldownLadder): number {
  const exponent = Math.max(0, n);
  const raw = ladder.baseMs * Math.pow(ladder.multiplier, exponent);
  return Math.min(raw, ladder.maxMs);
}

/**
 * Reschedule delay for a transient task failure. `InsufficientFundsForRent` uses
 * the slower funds ladder (the vault may be topped up between tries); every other
 * handled error / in-flight wait uses the standard ladder.
 */
export function retryCooldownMs(retries: number, insufficientFunds: boolean): number {
  const config = getConfig();
  const ladder: CooldownLadder = insufficientFunds
    ? {
        baseMs: config.insufficient_funds_cooldown_base_ms,
        maxMs: config.insufficient_funds_cooldown_max_ms,
        multiplier: config.insufficient_funds_cooldown_multiplier,
      }
    : {
        baseMs: config.retry_cooldown_base_ms,
        maxMs: config.retry_cooldown_max_ms,
        multiplier: config.retry_cooldown_multiplier,
      };
  return computeCooldown(retries, ladder);
}

/** Throttle delay before the next LIST round after `streak` consecutive rapid rounds. */
export function rapidCompletionCooldownMs(streak: number): number {
  const config = getConfig();
  return computeCooldown(streak, {
    baseMs: config.rapid_completion_cooldown_base_ms,
    maxMs: config.rapid_completion_cooldown_max_ms,
    multiplier: config.rapid_completion_cooldown_multiplier,
  });
}
