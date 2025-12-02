import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {
  ONE_MINUTE_IN_SECONDS,
  TEN_PERCENT,
  FIVE_MINUTES_IN_SECONDS,
  getNextExtendTime
} from './getNextExtendTime.js';

const mockNow = new Date('2025-12-02T14:00:00Z');

describe('getNextExtendTime', () => {

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(mockNow);
  })

  afterEach(async () => {
    vi.useRealTimers();
  })

  function secondsAfterNow(seconds: number) {
    return new Date(mockNow.getTime() + seconds * 1000);
  }

  describe('when not including buffer', () => {
    it.each([
      {timeout: -1},
      {timeout: 0},
      {timeout: 10},
      {timeout: 100},
      {timeout: 300},
      {timeout: 500},
      {timeout: 1000},
      {timeout: 10000},
    ])('extends in $timeout seconds', ({timeout}) => {
      const nextExtendTime = getNextExtendTime(timeout, false);

      expect(nextExtendTime).toStrictEqual(secondsAfterNow(timeout));
    });
  });

  describe('when including buffer', () => {
    describe('when default percentage of timeout is less or equal than 1 minute', () => {
      it.each([
        {timeout: -1},
        {timeout: 0},
        {timeout: 10},
        {timeout: 100},
        {timeout: 300},
        {timeout: 500},
        {timeout: 600},
      ])('extends in ($timeout - 1 minute) seconds when timeout is $timeout', ({timeout}) => {
        const nextExtendTime = getNextExtendTime(timeout, true);

        expect(nextExtendTime).toStrictEqual(secondsAfterNow(timeout - ONE_MINUTE_IN_SECONDS));
      });
    })

    describe('when 10% of timeout is greater than 1 minute but smaller than 5 minutes', () => {
      it.each([
        {timeout: 601},
        {timeout: 602},
        {timeout: 610},
        {timeout: 650},
        {timeout: 700},
        {timeout: 800},
        {timeout: 900},
        {timeout: 1000},
        {timeout: 2000},
        {timeout: 3000},
      ])('extends in ($timeout - 10% of timeout) seconds when timeout is $timeout', ({timeout}) => {
        const nextExtendTime = getNextExtendTime(timeout, true);

        expect(nextExtendTime).toStrictEqual(secondsAfterNow(timeout - timeout * TEN_PERCENT));
      });
    })

    describe('when 10% of timeout is greater than 5 minutes', () => {
      it.each([
        {timeout: 3001},
        {timeout: 3002},
        {timeout: 3010},
        {timeout: 3100},
        {timeout: 4000},
        {timeout: 5000},
        {timeout: 10000},
      ])('extends in ($timeout - 5 minutes) seconds when timeout is $timeout', ({timeout}) => {
        const nextExtendTime = getNextExtendTime(timeout, true);

        expect(nextExtendTime).toStrictEqual(secondsAfterNow(timeout - FIVE_MINUTES_IN_SECONDS));
      });
    })
  });
});
