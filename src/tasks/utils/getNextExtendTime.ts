
export function getNextExtendTime(timeout: number, includeBuffer = true): Date {
  const buffer = Math.min(Math.max(timeout * 0.1, 60), 300);
  const extendAt = includeBuffer ? timeout - buffer : timeout;

  return new Date(Date.now() + extendAt * 1000);
}