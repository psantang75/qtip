import { describe, it, expect } from 'vitest';
import { parsePagination, MAX_PAGE_SIZE } from '../common';

describe('parsePagination', () => {
  it('defaults page to 1 and limit to defaultLimit when absent', () => {
    expect(parsePagination({})).toEqual({ page: 1, limit: 20, skip: 0 });
    expect(parsePagination({}, { defaultLimit: 10 })).toEqual({ page: 1, limit: 10, skip: 0 });
  });

  it('parses numeric strings from query params', () => {
    expect(parsePagination({ page: '3', limit: '25' })).toEqual({ page: 3, limit: 25, skip: 50 });
  });

  it('accepts numbers as well as strings', () => {
    expect(parsePagination({ page: 2, limit: 15 })).toEqual({ page: 2, limit: 15, skip: 15 });
  });

  it('hard-caps limit at MAX_PAGE_SIZE (kills the old 5000 caps)', () => {
    expect(parsePagination({ limit: '5000' }).limit).toBe(MAX_PAGE_SIZE);
    expect(parsePagination({ limit: '999999' }).limit).toBe(MAX_PAGE_SIZE);
  });

  it('respects a lower per-endpoint maxLimit', () => {
    expect(parsePagination({ limit: '500' }, { maxLimit: 100 }).limit).toBe(100);
  });

  it('reads pageSize and perPage aliases', () => {
    expect(parsePagination({ pageSize: '30' }).limit).toBe(30);
    expect(parsePagination({ perPage: '40' }).limit).toBe(40);
    // explicit `limit` wins over aliases
    expect(parsePagination({ limit: '10', pageSize: '30' }).limit).toBe(10);
  });

  it('floors page/limit to at least 1 for zero, negative, and garbage input', () => {
    expect(parsePagination({ page: '0', limit: '0' }, { defaultLimit: 20 })).toEqual({ page: 1, limit: 20, skip: 0 });
    expect(parsePagination({ page: '-5', limit: '-5' }, { defaultLimit: 20 })).toEqual({ page: 1, limit: 20, skip: 0 });
    expect(parsePagination({ page: 'abc', limit: 'xyz' }, { defaultLimit: 20 })).toEqual({ page: 1, limit: 20, skip: 0 });
  });

  it('computes skip from page and limit', () => {
    expect(parsePagination({ page: '5', limit: '20' }).skip).toBe(80);
  });
});
