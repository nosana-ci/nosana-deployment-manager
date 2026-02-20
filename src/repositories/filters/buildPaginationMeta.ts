import { WithId, Document } from 'mongodb';
import { PaginationMeta, PageSize, CursorDirection } from './types.js';
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
 * @param direction - The direction of navigation ('next', 'prev', or undefined for first page)
 * @returns Pagination metadata object and trimmed items array
 */
export function buildPaginationMeta<T extends Document>(
  items: WithId<T>[],
  limit: PageSize,
  totalItems: number,
  sortField: string,
  hasCursor: boolean,
  direction?: CursorDirection
): { pagination: PaginationMeta; items: WithId<T>[] } {
  // Check if there are more items than requested (meaning more pages exist)
  const hasMoreItems = items.length > limit;

  const trimmedItems = items.slice(0, limit);

  // When navigating with 'prev', hasMoreItems indicates there are more items backwards
  // When navigating with 'next' or no cursor, hasMoreItems indicates there are more items forwards
  let cursor_next: string | null = null;
  let cursor_prev: string | null = null;

  if (trimmedItems.length > 0) {
    if (direction === 'prev') {
      // When going backwards:
      // - cursor_next always exists (we can go forward to where we came from)
      // - cursor_prev exists if hasMoreItems (can go further back)
      const lastItem = trimmedItems[trimmedItems.length - 1];
      cursor_next = encodeCursor({
        sort_field_value: lastItem[sortField],
        _id: lastItem._id.toString(),
        direction: 'next',
      });

      if (hasMoreItems) {
        const firstItem = trimmedItems[0];
        cursor_prev = encodeCursor({
          sort_field_value: firstItem[sortField],
          _id: firstItem._id.toString(),
          direction: 'prev',
        });
      }
    } else {
      // When going forwards or first page:
      // - cursor_next exists if hasMoreItems (more pages ahead)
      // - cursor_prev exists if hasCursor (not on first page)
      if (hasMoreItems) {
        const lastItem = trimmedItems[trimmedItems.length - 1];
        cursor_next = encodeCursor({
          sort_field_value: lastItem[sortField],
          _id: lastItem._id.toString(),
          direction: 'next',
        });
      }

      if (hasCursor) {
        const firstItem = trimmedItems[0];
        cursor_prev = encodeCursor({
          sort_field_value: firstItem[sortField],
          _id: firstItem._id.toString(),
          direction: 'prev',
        });
      }
    }
  }

  const pagination: PaginationMeta = {
    cursor_next,
    cursor_prev,
    total_items: totalItems,
  };

  return { pagination, items: trimmedItems };
}
