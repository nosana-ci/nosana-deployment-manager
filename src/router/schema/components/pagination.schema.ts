import { Type, Static, TSchema } from "@sinclair/typebox";

export const PaginationQuerySchema = Type.Object({
  cursor: Type.Optional(
    Type.String({
      description: "Base64-encoded cursor for keyset pagination",
    })
  ),
  limit: Type.Optional(
    Type.Union([
      // Accept both string and number forms since query params are strings
      Type.Literal(10), Type.Literal(20), Type.Literal(50), Type.Literal(100),
      Type.Literal("10"), Type.Literal("20"), Type.Literal("50"), Type.Literal("100"),
    ], {
      default: 10,
      description: "Number of items per page (10, 20, 50, or 100)",
    })
  ),
  sort_order: Type.Optional(
    Type.Union([
      Type.Literal('asc'),
      Type.Literal('desc'),
    ], {
      default: 'desc',
      description: "Sort order: 'asc' (oldest first) or 'desc' (newest first)",
    })
  ),
});

export const PaginationMetaSchema = Type.Object({
  cursor_next: Type.Union([Type.String(), Type.Null()], {
    description: "Cursor for next page, null if no more pages"
  }),
  cursor_prev: Type.Union([Type.String(), Type.Null()], {
    description: "Cursor for previous page, null if on first page"
  }),
  total_items: Type.Number({
    description: "Total number of items in collection"
  }),
});

export type PaginationQuery = Static<typeof PaginationQuerySchema>;
export type PaginationMeta = Static<typeof PaginationMetaSchema>;

// Helper function to combine pagination and filter schemas
export function withFilters(filterSchema: TSchema) {
  return Type.Composite([PaginationQuerySchema, filterSchema]);
}

// Helper function to create a paginated response schema
export function withPagination(resourceName: string, itemsSchema: TSchema) {
  return Type.Object({
    [resourceName]: Type.Array(itemsSchema),
    pagination: PaginationMetaSchema,
  });
}

// TypeScript type helper for paginated responses
export type WithPagination<T, K extends string> = {
  [key in K]: T[];
} & {
  pagination: PaginationMeta;
};
