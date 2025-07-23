import { FilterOperators, Filters } from "../types.js";
import { matchValue } from "./matchValue.js";

export function matchFilter<T extends object>(
  obj: T,
  filter: Filters<T>,
): boolean {
  // Compound filters
  if ("$and" in filter) {
    return filter.$and.every((f) => matchFilter(obj, f));
  }
  if ("$or" in filter) {
    return filter.$or.some((f) => matchFilter(obj, f));
  }
  if ("$not" in filter) {
    return !matchFilter(obj, filter.$not);
  }

  // Field filters
  for (const key in filter) {
    const fieldValue = obj[key as keyof T];
    const condition = filter[key as keyof T] as FilterOperators<unknown>;

    if (!matchValue(fieldValue, condition)) {
      return false;
    }
  }

  return true;
}
