import { FilterOperators } from "../types.js";

const SUPPORTED_OPERATORS = [
  "$eq",
  "$ne",
  "$in",
  "$nin",
  "$gt",
  "$gte",
  "$lt",
  "$lte",
] as const;

const SUPPORTED_OPERATOR_SET: ReadonlySet<string> = new Set(SUPPORTED_OPERATORS);

export function matchValue<T>(fieldValue: T, condition: FilterOperators<T>): boolean {
  // Fail loudly on operators we don't implement. The `{}` member of
  // FilterOperators lets unsupported operators (e.g. a value-level `$or`, or a
  // typo) pass the type checker, where they would otherwise be silently ignored
  // and cause the condition to match everything.
  for (const operator of Object.keys(condition)) {
    if (!SUPPORTED_OPERATOR_SET.has(operator)) {
      throw new Error(
        `Unsupported filter operator "${operator}". Supported operators: ${SUPPORTED_OPERATORS.join(", ")}.`,
      );
    }
  }

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
