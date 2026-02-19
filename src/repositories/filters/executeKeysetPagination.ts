import type { Collection, Document, Filter, WithId } from 'mongodb';
import { generateKeysetQuery } from './generateKeysetQuery.js';
import { buildPaginationMeta } from './buildPaginationMeta.js';
import type { SortOrder, PageSize, PaginationMeta } from './types.js';

/**
 * Options for executing keyset pagination on a MongoDB collection
 */
export interface ExecuteKeysetPaginationOptions<T extends Document = Document> {
  /** MongoDB collection to query */
  collection: Collection<T>;
  /** Combined MongoDB filter object */
  filters: Filter<T>;
  /** Field to sort by (e.g., 'created_at', 'revision') */
  sortField: string;
  /** Sort order ('asc' or 'desc') */
  sortOrder: SortOrder;
  /** Page size */
  limit: PageSize;
  /** Base64-encoded cursor (optional, omit for first page) */
  cursor?: string;
}

/**
 * Result from executing keyset pagination
 */
export interface KeysetPaginationResult<T extends Document = Document> {
  /** Array of items for the current page */
  items: WithId<T>[];
  /** Pagination metadata including cursors and navigation info */
  pagination: PaginationMeta;
}

/**
 * Executes keyset (cursor-based) pagination on a MongoDB collection
 * 
 * This function combines:
 * - Filter building
 * - Keyset query generation
 * - Parallel fetching of data and total count
 * - Pagination metadata construction
 * 
 * @param options - Pagination configuration options
 * @returns Paginated results with items and metadata
 * 
 * @example
 * ```typescript
 * const filters = combineFilters(
 *   { owner: userId },
 *   buildMultiValueFilter('status', status),
 *   buildDateRangeFilter('created_at', created_after, created_before)
 * );
 * 
 * const { items, pagination } = await executeKeysetPagination({
 *   collection: db.deployments,
 *   filters,
 *   sortField: 'created_at',
 *   sortOrder: 'desc',
 *   limit: 10,
 *   cursor: req.query.cursor
 * });
 * ```
 */
export async function executeKeysetPagination<T extends Document = Document>(
  options: ExecuteKeysetPaginationOptions<T>
): Promise<KeysetPaginationResult<T>> {
  const { collection, filters, sortField, sortOrder, limit, cursor } = options;

  // Generate keyset query
  const { query, sort, limit: fetchLimit } = generateKeysetQuery({
    cursor,
    sortField,
    sortOrder,
    limit,
    baseFilter: filters as Record<string, unknown>,
  });

  // Fetch data and total count in parallel
  const [results, total] = await Promise.all([
    collection
      .find(query as Filter<T>)
      .sort(sort)
      .limit(fetchLimit)
      .toArray(),
    collection.countDocuments(filters),
  ]);

  // Build pagination metadata
  const { pagination, items } = buildPaginationMeta(
    results,
    limit,
    total,
    sortField,
    !!cursor
  );

  return {
    items,
    pagination,
  };
}
