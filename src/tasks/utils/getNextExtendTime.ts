export const TEN_PERCENT = 0.1;
export const ONE_MINUTE_IN_SECONDS = 60;
export const FIVE_MINUTES_IN_SECONDS = 300;

export function getNextExtendTime(timeout: number, includeBuffer = true): Date {
  const buffer = Math.min(Math.max((timeout * ONE_MINUTE_IN_SECONDS) * TEN_PERCENT, ONE_MINUTE_IN_SECONDS), FIVE_MINUTES_IN_SECONDS);
  const extendAt = includeBuffer ? (timeout * ONE_MINUTE_IN_SECONDS) - buffer : (timeout * ONE_MINUTE_IN_SECONDS);

  return new Date(Date.now() + extendAt * 1000);
}