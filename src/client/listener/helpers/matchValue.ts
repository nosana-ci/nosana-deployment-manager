import { FilterOperators } from "../types.js";

export function matchValue<T>(fieldValue: T, condition: FilterOperators<T>): boolean {
  const isComparable = (v: unknown): v is number | Date =>
    typeof v === "number" || v instanceof Date;

  if ("$eq" in condition && fieldValue !== condition.$eq) return false;
  if ("$ne" in condition && fieldValue === condition.$ne) return false;
  if ("$in" in condition && !condition.$in?.includes(fieldValue)) return false;
  if ("$nin" in condition && condition.$nin?.includes(fieldValue)) return false;

  if ("$gt" in condition && isComparable(fieldValue) && fieldValue <= condition.$gt!)
    return false;
  if ("$gte" in condition && typeof fieldValue === "number" && fieldValue < condition.$gte!)
    return false;
  if ("$lt" in condition && isComparable(fieldValue) && fieldValue >= condition.$lt!)
    return false;
  if ("$lte" in condition && typeof fieldValue === "number" && fieldValue > condition.$lte!)
    return false;

  return true;
}
