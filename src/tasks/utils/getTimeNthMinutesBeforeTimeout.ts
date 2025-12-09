import { getConfig } from "../../config/index.js";

export function getTimeNthMinutesBeforeTimeout(timeout: number, seconds: number = getConfig().default_seconds_before_timeout) {
  return new Date(Date.now() + (timeout - seconds) * 1000);
}