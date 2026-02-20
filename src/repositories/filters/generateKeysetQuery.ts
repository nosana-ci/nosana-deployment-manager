import { ObjectId } from 'mongodb';
import { KeysetPaginationOptions, KeysetQueryResult } from './types.js';
import { decodeCursor } from './cursor.js';

/**
 * Generates a MongoDB query for keyset (cursor-based) pagination
 * 
 * @param options - Pagination options including cursor, sort field, and order
 * @returns Query object and sort object for MongoDB
 * 
 * @example
 * // First page, descending order (newest first)
 * generateKeysetQuery({ sortField: 'created_at', sortOrder: 'desc', limit: 10 })
 * // Returns: { query: {}, sort: { created_at: -1, _id: -1 } }
 * 
 * @example
 * // Next page, descending order
 * generateKeysetQuery({ 
 *   cursor: 'base64cursor',
 *   sortField: 'created_at', 
 *   sortOrder: 'desc',
 *   limit: 10 
 * })
 * // Returns: { 
 * //   query: { $or: [
 * //     { created_at: { $lt: cursorValue } },
 * //     { created_at: cursorValue, _id: { $lt: cursorId } }
 * //   ]},
 * //   sort: { created_at: -1, _id: -1 }
 * // }
 */
export function generateKeysetQuery(
  options: KeysetPaginationOptions
): KeysetQueryResult {
  const { cursor, sortField, sortOrder, limit, baseFilter = {} } = options;

  // Determine MongoDB sort direction
  const sortDirection: 1 | -1 = sortOrder === 'asc' ? 1 : -1;
  const sort: Record<string, 1 | -1> = {
    [sortField]: sortDirection,
    _id: sortDirection
  };

  // If no cursor, return first page query
  if (!cursor) {
    return {
      query: baseFilter,
      sort,
      limit: limit + 1, // Fetch one extra to detect has_next_page
    };
  }

  // Decode and validate cursor
  const cursorData = decodeCursor(cursor);
  const cursorId = new ObjectId(cursorData._id);

  // Convert ISO date strings back to Date objects for proper MongoDB comparison
  let sortFieldValue = cursorData.sort_field_value;
  if (typeof sortFieldValue === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/.test(sortFieldValue)) {
    sortFieldValue = new Date(sortFieldValue);
  }

  // When navigating backwards (prev), we need to reverse the sort order
  // to fetch items in the opposite direction, then reverse the results
  const isReversed = cursorData.direction === 'prev';
  const effectiveSortDirection: 1 | -1 = isReversed ? (sortDirection === 1 ? -1 : 1) : sortDirection;
  const effectiveSort: Record<string, 1 | -1> = {
    [sortField]: effectiveSortDirection,
    _id: effectiveSortDirection
  };

  // Determine comparison operators based on effective sort direction
  // Always get items in the direction opposite to the sort
  let sortFieldOp: '$lt' | '$gt';
  let idOp: '$lt' | '$gt';

  if (effectiveSortDirection === -1) {
    // DESC sort: get items less than cursor
    sortFieldOp = '$lt';
    idOp = '$lt';
  } else {
    // ASC sort: get items greater than cursor
    sortFieldOp = '$gt';
    idOp = '$gt';
  }

  // Build the keyset query using $or for handling ties
  // The query means: "Get items where sort_field is before/after cursor OR
  // sort_field equals cursor but _id is before/after cursor"
  const keysetQuery = {
    $or: [
      { [sortField]: { [sortFieldOp]: sortFieldValue } },
      {
        [sortField]: sortFieldValue,
        _id: { [idOp]: cursorId },
      },
    ],
  };

  // Merge with base filter (e.g., deployment: deploymentId)
  const query = Object.keys(baseFilter).length > 0
    ? { $and: [baseFilter, keysetQuery] }
    : keysetQuery;

  return {
    query,
    sort: effectiveSort,
    limit: limit + 1, // Fetch one extra to detect has_next_page
    direction: cursorData.direction,
  };
}
