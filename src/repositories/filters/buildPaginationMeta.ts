import { WithId, Document } from 'mongodb';
import { PaginationMeta, PageSize } from './types.js';
import { encodeCursor } from './cursor.js';

/**
 * Builds pagination metadata from query results
 * 
 * This function handles:
 * - Detecting if there are more pages (by checking if we got limit+1 items)
 * - Generating next/previous cursors
 * 
 * @param items - Array of items returned from database (should be limit+1)
 * @param limit - The requested page size (NOT limit+1)
 * @param totalItems - Total count of items in collection (for display)
 * @param sortField - The field used for sorting (e.g., 'created_at', 'revision')
 * @param hasCursor - Whether the request included a cursor (false = first page)
 * @returns Pagination metadata object and trimmed items array
 */
export function buildPaginationMeta<T extends Document>(
  items: WithId<T>[],
  limit: PageSize,
  totalItems: number,
  sortField: string,
  hasCursor: boolean
): { pagination: PaginationMeta; items: WithId<T>[] } {
  // Check if there are more items than requested (meaning more pages exist)
  const hasMoreItems = items.length > limit;

  const trimmedItems = items.slice(0, limit);

  // Generate cursor_next (cursor to get the next page)
  // null when no more pages exist
  let cursor_next: string | null = null;
  if (hasMoreItems) {
    const lastItem = trimmedItems[trimmedItems.length - 1];
    cursor_next = encodeCursor({
      sort_field_value: lastItem[sortField],
      _id: lastItem._id.toString(),
      direction: 'next',
    });
  }

  // Generate cursor_prev (cursor to get the previous page)
  // null on first page (when no cursor was provided)
  let cursor_prev: string | null = null;
  if (hasCursor) {
    const firstItem = trimmedItems[0];
    cursor_prev = encodeCursor({
      sort_field_value: firstItem[sortField],
      _id: firstItem._id.toString(),
      direction: 'prev',
    });
  }

  const pagination: PaginationMeta = {
    cursor_next,
    cursor_prev,
    total_items: totalItems,
  };

  return { pagination, items: trimmedItems };
}
