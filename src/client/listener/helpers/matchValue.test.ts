import { describe, it, expect } from 'vitest';
import { matchValue } from './matchValue.js';

describe('matchValue', () => {
  describe('$eq operator', () => {
    it('should return true when value equals the operator value', () => {
      expect(matchValue(5, { $eq: 5 })).toBe(true);
      expect(matchValue('test', { $eq: 'test' })).toBe(true);
    });

    it('should return false when value does not equal the operator value', () => {
      expect(matchValue(5, { $eq: 10 })).toBe(false);
      expect(matchValue('test', { $eq: 'other' })).toBe(false);
    });
  });

  describe('$ne operator', () => {
    it('should return true when value does not equal the operator value', () => {
      expect(matchValue(5, { $ne: 10 })).toBe(true);
      expect(matchValue('test', { $ne: 'other' })).toBe(true);
    });

    it('should return false when value equals the operator value', () => {
      expect(matchValue(5, { $ne: 5 })).toBe(false);
      expect(matchValue('test', { $ne: 'test' })).toBe(false);
    });
  });

  describe('$gt operator', () => {
    it('should return true when value is greater than the operator value', () => {
      expect(matchValue(10, { $gt: 5 })).toBe(true);
    });

    it('should return false when value is less than or equal to the operator value', () => {
      expect(matchValue(5, { $gt: 10 })).toBe(false);
      expect(matchValue(5, { $gt: 5 })).toBe(false);
    });

    it('should work with Date objects', () => {
      const date1 = new Date('2024-01-01');
      const date2 = new Date('2024-01-02');

      expect(matchValue(date2, { $gt: date1 })).toBe(true);
      expect(matchValue(date1, { $gt: date2 })).toBe(false);
    });
  });

  describe('$gte operator', () => {
    it('should return true when value is greater than or equal to the operator value', () => {
      expect(matchValue(10, { $gte: 5 })).toBe(true);
      expect(matchValue(5, { $gte: 5 })).toBe(true);
    });

    it('should return false when value is less than the operator value', () => {
      expect(matchValue(5, { $gte: 10 })).toBe(false);
    });
  });

  describe('$lt operator', () => {
    it('should return true when value is less than the operator value', () => {
      expect(matchValue(5, { $lt: 10 })).toBe(true);
    });

    it('should return false when value is greater than or equal to the operator value', () => {
      expect(matchValue(10, { $lt: 5 })).toBe(false);
      expect(matchValue(5, { $lt: 5 })).toBe(false);
    });

    it('should work with Date objects', () => {
      const date1 = new Date('2024-01-01');
      const date2 = new Date('2024-01-02');

      expect(matchValue(date1, { $lt: date2 })).toBe(true);
      expect(matchValue(date2, { $lt: date1 })).toBe(false);
    });
  });

  describe('$lte operator', () => {
    it('should return true when value is less than or equal to the operator value', () => {
      expect(matchValue(5, { $lte: 10 })).toBe(true);
      expect(matchValue(5, { $lte: 5 })).toBe(true);
    });

    it('should return false when value is greater than the operator value', () => {
      expect(matchValue(10, { $lte: 5 })).toBe(false);
    });
  });

  describe('combined operators', () => {
    it('should handle multiple operators in a single condition', () => {
      expect(matchValue(5, { $gt: 3, $lt: 10 })).toBe(true);
      expect(matchValue(15, { $gt: 3, $lt: 10 })).toBe(false);
      expect(matchValue(2, { $gt: 3, $lt: 10 })).toBe(false);
    });

    it('should handle range with gte and lte', () => {
      expect(matchValue(5, { $gte: 5, $lte: 10 })).toBe(true);
      expect(matchValue(10, { $gte: 5, $lte: 10 })).toBe(true);
      expect(matchValue(3, { $gte: 5, $lte: 10 })).toBe(false);
      expect(matchValue(12, { $gte: 5, $lte: 10 })).toBe(false);
    });
  });
});
