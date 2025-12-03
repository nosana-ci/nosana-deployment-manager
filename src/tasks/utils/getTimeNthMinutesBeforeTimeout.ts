import { getConfig } from "../../config/index.js";

export function getTimeNthMinutesBeforeTimeout(timeout: number, minutes: number = getConfig().default_minutes_before_timeout) {
  return new Date(Date.now() + (timeout - minutes * 60) * 1000);
}