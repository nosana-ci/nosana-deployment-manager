/**
 * Sort order for pagination
 */
export type SortOrder = 'asc' | 'desc';

/**
 * Cursor direction for navigation
 */
export type CursorDirection = 'next' | 'prev';

/**
 * Page size options
 */
export type PageSize = number;

/**
 * Cursor data structure (decoded from base64)
 */
export interface CursorData {
  sort_field_value: unknown; // Value of the sort field (e.g., timestamp or revision number)
  _id: string;               // MongoDB ObjectId as string (tiebreaker)
  direction: CursorDirection; // Navigation direction
}

/**
 * Pagination metadata returned in API responses
 */
export interface PaginationMeta {
  cursor_next: string | null;     // null when no more pages
  cursor_prev: string | null;     // null on first page
  total_items: number;
}

/**
 * Options for generating keyset pagination queries
 */
export interface KeysetPaginationOptions {
  cursor?: string;                          // Base64-encoded cursor
  sortField: string;                        // Field to sort by (e.g., 'created_at', 'revision')
  sortOrder: SortOrder;                     // Sort direction
  limit: PageSize;                          // Page size
  baseFilter?: Record<string, unknown>;     // Additional filters (e.g., { deployment: 'abc' })
}

/**
 * Result from keyset query generator
 */
export interface KeysetQueryResult {
  query: Record<string, unknown>;     // MongoDB query object
  sort: Record<string, 1 | -1>;      // MongoDB sort object
  limit: number;                      // Actual limit to fetch (limit + 1)
  direction?: CursorDirection;        // Navigation direction (if cursor was used)
}

