import { CursorData } from './types.js';

/**
 * Encodes cursor data into a base64 string for use in pagination
 * @param data - The cursor data to encode
 * @returns Base64-encoded cursor string
 */
export function encodeCursor(data: CursorData): string {
  const json = JSON.stringify(data);
  return Buffer.from(json, 'utf-8').toString('base64');
}

/**
 * Decodes a base64 cursor string back into cursor data
 * @param cursor - The base64-encoded cursor string
 * @returns Decoded cursor data
 * @throws Error if cursor is invalid or cannot be decoded
 */
export function decodeCursor(cursor: string): CursorData {
  try {
    const json = Buffer.from(cursor, 'base64').toString('utf-8');
    const data = JSON.parse(json);

    if (!('sort_field_value' in data)) {
      throw new Error('Cursor missing sort_field_value');
    }

    if (!data._id || typeof data._id !== 'string') {
      throw new Error('Cursor missing valid _id');
    }

    if (data.direction !== 'next' && data.direction !== 'prev') {
      throw new Error('Cursor direction must be "next" or "prev"');
    }

    return data as CursorData;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Invalid cursor: ${error.message}`);
    }
    throw new Error('Invalid cursor: Unable to decode');
  }
}
