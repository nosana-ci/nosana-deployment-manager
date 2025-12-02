export const ONE_MINUTE_IN_SECONDS = 60;
export const TEN_PERCENT = 0.1;
export const FIVE_MINUTES_IN_SECONDS = 300;

export function getNextExtendTime(timeout: number, includeBuffer = true): Date {
  const buffer = Math.min(Math.max(timeout * TEN_PERCENT, ONE_MINUTE_IN_SECONDS), FIVE_MINUTES_IN_SECONDS);
  const extendAt = includeBuffer ? timeout - buffer : timeout;

  return new Date(Date.now() + extendAt * 1000);
}