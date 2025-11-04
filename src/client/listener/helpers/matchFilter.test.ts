import { describe, it, expect } from 'vitest';
import { matchFilter } from './matchFilter.js';

describe('matchFilter', () => {
  interface TestObject {
    name: string;
    age: number;
    status: string;
  }

  describe('field filters', () => {
    it('should match object with $eq operator', () => {
      const obj: TestObject = { name: 'John', age: 30, status: 'active' };

      expect(matchFilter(obj, { name: { $eq: 'John' } })).toBe(true);
      expect(matchFilter(obj, { name: { $eq: 'Jane' } })).toBe(false);
    });

    it('should match object with $ne operator', () => {
      const obj: TestObject = { name: 'John', age: 30, status: 'active' };

      expect(matchFilter(obj, { name: { $ne: 'Jane' } })).toBe(true);
      expect(matchFilter(obj, { name: { $ne: 'John' } })).toBe(false);
    });

    it('should match object with comparison operators', () => {
      const obj: TestObject = { name: 'John', age: 30, status: 'active' };

      expect(matchFilter(obj, { age: { $gt: 25 } })).toBe(true);
      expect(matchFilter(obj, { age: { $gt: 35 } })).toBe(false);
      expect(matchFilter(obj, { age: { $gte: 30 } })).toBe(true);
      expect(matchFilter(obj, { age: { $lt: 35 } })).toBe(true);
      expect(matchFilter(obj, { age: { $lte: 30 } })).toBe(true);
    });

    it('should match object with multiple field conditions', () => {
      const obj: TestObject = { name: 'John', age: 30, status: 'active' };

      expect(matchFilter(obj, {
        name: { $eq: 'John' },
        age: { $gte: 25 },
      })).toBe(true);

      expect(matchFilter(obj, {
        name: { $eq: 'John' },
        age: { $gt: 35 },
      })).toBe(false);
    });
  });

  describe('$and operator', () => {
    it('should return true when all conditions are met', () => {
      const obj: TestObject = { name: 'John', age: 30, status: 'active' };

      expect(matchFilter(obj, {
        $and: [
          { name: { $eq: 'John' } },
          { age: { $gte: 25 } },
          { status: { $eq: 'active' } },
        ],
      })).toBe(true);
    });

    it('should return false when any condition is not met', () => {
      const obj: TestObject = { name: 'John', age: 30, status: 'active' };

      expect(matchFilter(obj, {
        $and: [
          { name: { $eq: 'John' } },
          { age: { $gt: 35 } },
          { status: { $eq: 'active' } },
        ],
      })).toBe(false);
    });

    it('should handle empty $and array', () => {
      const obj: TestObject = { name: 'John', age: 30, status: 'active' };

      expect(matchFilter(obj, { $and: [] })).toBe(true);
    });
  });

  describe('$or operator', () => {
    it('should return true when at least one condition is met', () => {
      const obj: TestObject = { name: 'John', age: 30, status: 'active' };

      expect(matchFilter(obj, {
        $or: [
          { name: { $eq: 'Jane' } },
          { age: { $gte: 25 } },
        ],
      })).toBe(true);
    });

    it('should return false when no conditions are met', () => {
      const obj: TestObject = { name: 'John', age: 30, status: 'active' };

      expect(matchFilter(obj, {
        $or: [
          { name: { $eq: 'Jane' } },
          { age: { $gt: 40 } },
          { status: { $eq: 'inactive' } },
        ],
      })).toBe(false);
    });

    it('should handle empty $or array', () => {
      const obj: TestObject = { name: 'John', age: 30, status: 'active' };

      expect(matchFilter(obj, { $or: [] })).toBe(false);
    });
  });

  describe('$not operator', () => {
    it('should return true when condition is not met', () => {
      const obj: TestObject = { name: 'John', age: 30, status: 'active' };

      expect(matchFilter(obj, {
        $not: { name: { $eq: 'Jane' } },
      })).toBe(true);
    });

    it('should return false when condition is met', () => {
      const obj: TestObject = { name: 'John', age: 30, status: 'active' };

      expect(matchFilter(obj, {
        $not: { name: { $eq: 'John' } },
      })).toBe(false);
    });
  });

  describe('complex nested filters', () => {
    it('should handle nested $and and $or operators', () => {
      const obj: TestObject = { name: 'John', age: 30, status: 'active' };

      expect(matchFilter(obj, {
        $and: [
          {
            $or: [
              { name: { $eq: 'John' } },
              { name: { $eq: 'Jane' } },
            ],
          },
          { age: { $gte: 25 } },
        ],
      })).toBe(true);
    });

    it('should handle complex nested logic', () => {
      const obj: TestObject = { name: 'John', age: 30, status: 'active' };

      expect(matchFilter(obj, {
        $or: [
          {
            $and: [
              { name: { $eq: 'Jane' } },
              { age: { $gt: 25 } },
            ],
          },
          {
            $and: [
              { name: { $eq: 'John' } },
              { status: { $eq: 'active' } },
            ],
          },
        ],
      })).toBe(true);
    });

    it('should handle $not with nested conditions', () => {
      const obj: TestObject = { name: 'John', age: 30, status: 'active' };

      expect(matchFilter(obj, {
        $not: {
          $and: [
            { name: { $eq: 'Jane' } },
            { age: { $gt: 40 } },
          ],
        },
      })).toBe(true);
    });
  });
});
