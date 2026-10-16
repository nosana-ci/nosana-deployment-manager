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
 * Builds a multi-value filter on a nested path (e.g. `requirements.name`),
 * which the typed builders cannot name. Matches a scalar or any element of a
 * list at that path, as MongoDB does. With `noneMeansMissing`, the value
 * `none` selects documents with nothing at that path, and may be combined
 * with real values (`none,RTX 4090` is either).
 * @param path - Dotted field path
 * @param value - Single value or comma-separated list
 */
export function buildNestedMultiValueFilter(
  path: string,
  value: string | undefined,
  { noneMeansMissing = false }: { noneMeansMissing?: boolean } = {}
): Record<string, unknown> | undefined {
  if (!value) return undefined;

  const all = parseMultiValue(value);
  const values = noneMeansMissing ? all.filter((v) => v !== 'none') : all;
  const missing = noneMeansMissing && values.length < all.length;
  const present =
    values.length === 0 ? undefined
    : values.length === 1 ? { [path]: values[0] }
    : { [path]: { $in: values } };
  if (!missing) return present;
  const absent = { [path]: { $exists: false } };
  return present ? { $or: [present, absent] } : absent;
}

/**
 * Builds a market filter: addresses as a multi-value filter, where `none`
 * stands for deployments without a pinned market (null).
 * @param field - The market field name
 * @param value - Single value or comma-separated list, possibly including `none`
 */
export function buildMarketFilter<T extends Document = Document>(
  field: keyof T & string,
  value: string | undefined
): Record<string, unknown> | undefined {
  if (!value) return undefined;

  const values = parseMultiValue(value).map((v) => (v === 'none' ? null : v));
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
 * Builds a partial match filter using regex (case-insensitive)
 * Creates an $or query to search across multiple fields
 * @param fields - Array of field names to search across
 * @param searchTerm - The search term to match partially
 * @returns MongoDB $or query with $regex
 */
export function buildPartialMatchFilter<T extends Document = Document>(
  fields: (keyof T & string)[],
  searchTerm: string | undefined
): Record<string, unknown> | undefined {
  if (!searchTerm || searchTerm.trim() === '') return undefined;

  // Escape special regex characters to prevent regex injection
  const escapedTerm = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  return {
    $or: fields.map(field => ({
      [field]: { $regex: escapedTerm, $options: 'i' }
    }))
  };
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
