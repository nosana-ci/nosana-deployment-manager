/**
 * Utilities for building MongoDB filter queries from query parameters
 */

import type { Document } from 'mongodb';

/**
 * Parses a comma-separated string into an array
 * @param value - String value or comma-separated list
 * @returns Array of values
 */
function parseMultiValue(value: string): string[] {
  return value.split(',').map(v => v.trim());
}

/**
 * Builds a date range filter for MongoDB (typed version)
 * @param field - The field name to filter on (must be a key of T)
 * @param after - ISO 8601 date string for start of range
 * @param before - ISO 8601 date string for end of range
 * @returns MongoDB date range query
 */
export function buildDateRangeFilter<T extends Document = Document>(
  field: keyof T & string,
  after?: string,
  before?: string
): Record<string, unknown> | undefined {
  if (!after && !before) return undefined;
  return {
    [field]: {
      ...(after ? { $gte: new Date(after) } : {}),
      ...(before ? { $lte: new Date(before) } : {}),
    }
  };
}

/**
 * Builds a multi-value filter (for comma-separated lists) - typed version
 * @param field - The field name to filter on (must be a key of T)
 * @param value - Single value or comma-separated list
 * @returns MongoDB $in query or equality query
 */
export function buildMultiValueFilter<T extends Document = Document>(
  field: keyof T & string,
  value: string | undefined
): Record<string, unknown> | undefined {
  if (!value) return undefined;

  const values = parseMultiValue(value);
  return values.length === 1 ? { [field]: values[0] } : { [field]: { $in: values } };
}

/**
 * Builds a single value filter - typed version
 * @param field - The field name to filter on (must be a key of T)
 * @param value - The value to filter by
 * @returns MongoDB equality query
 */
export function buildSingleValueFilter<T extends Document = Document>(
  field: keyof T & string,
  value: string | number | undefined
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  return { [field]: value };
}

/**
 * Combines multiple filter objects into a single MongoDB query
 * Filters out undefined values
 * @param filters - Array of filter objects
 * @returns Combined MongoDB query object
 */
export function combineFilters(...filters: (Record<string, unknown> | undefined)[]): Record<string, unknown> {
  return Object.assign({}, ...filters.filter(f => f !== undefined));
}
