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
  const sortFieldValue = cursorData.sort_field_value;

  // Determine comparison operators based on direction and navigation
  // For "next" with DESC: we want items BEFORE the cursor (< cursor value)
  // For "next" with ASC: we want items AFTER the cursor (> cursor value)
  // For "prev" with DESC: we want items AFTER the cursor (> cursor value)
  // For "prev" with ASC: we want items BEFORE the cursor (< cursor value)
  
  let sortFieldOp: '$lt' | '$gt';
  let idOp: '$lt' | '$gt';

  if (cursorData.direction === 'next') {
    // Moving forward in pagination
    if (sortOrder === 'desc') {
      sortFieldOp = '$lt'; // Get older items
      idOp = '$lt';
    } else {
      sortFieldOp = '$gt'; // Get newer items
      idOp = '$gt';
    }
  } else {
    // Moving backward in pagination (prev)
    if (sortOrder === 'desc') {
      sortFieldOp = '$gt'; // Get newer items
      idOp = '$gt';
    } else {
      sortFieldOp = '$lt'; // Get older items
      idOp = '$lt';
    }
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
    sort,
    limit: limit + 1, // Fetch one extra to detect has_next_page
  };
}
