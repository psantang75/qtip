/**
 * Locks the visibility contract for Internal-form scoping (`utils/formScope`).
 *
 * These pure helpers are the single source of truth for "who sees Internal data
 * and where", so their behaviour is asserted directly:
 *
 *  1. `accessScopeClause` — STANDARD hides Internal (`access_mode IS NULL`),
 *     INTERNAL shows only Internal rows. A regression here would either leak
 *     internal audits onto agent surfaces or hide normal audits.
 *  2. `parseAccessRoles` — tolerant of array or JSON-string storage and
 *     normalises casing, since the column is written from a UI multi-select.
 *  3. `canAccessInternalForm` — admin always passes; normal forms are open;
 *     Internal forms gate on the per-form audience.
 */
import { describe, it, expect } from 'vitest';
import {
  accessScopeClause,
  standardScopeClause,
  parseAccessRoles,
  parseAccessUsers,
  userToken,
  isValidRoleKey,
  normalizeRole,
  isInternalForm,
  canAccessInternalForm,
  INTERNAL_MODE,
} from '../formScope';

describe('accessScopeClause', () => {
  it('STANDARD excludes Internal rows', () => {
    expect(accessScopeClause('STANDARD')).toBe("AND s.access_mode IS NULL");
    expect(standardScopeClause()).toBe("AND s.access_mode IS NULL");
  });

  it('INTERNAL includes only Internal rows', () => {
    expect(accessScopeClause('INTERNAL')).toBe("AND s.access_mode = 'INTERNAL'");
  });

  it('honours a custom table alias', () => {
    expect(accessScopeClause('STANDARD', 'sub')).toBe('AND sub.access_mode IS NULL');
    expect(accessScopeClause('INTERNAL', 'sub')).toBe("AND sub.access_mode = 'INTERNAL'");
  });
});

describe('parseAccessRoles', () => {
  it('parses a plain array and normalises casing', () => {
    expect(parseAccessRoles(['QA', 'Manager'])).toEqual(['qa', 'manager']);
  });

  it('parses a JSON-string column value', () => {
    expect(parseAccessRoles('["qa","trainer"]')).toEqual(['qa', 'trainer']);
  });

  it('returns [] for null / invalid input', () => {
    expect(parseAccessRoles(null)).toEqual([]);
    expect(parseAccessRoles(undefined)).toEqual([]);
    expect(parseAccessRoles('not json')).toEqual([]);
  });

  it('ignores individual-user tokens and unknown keys', () => {
    expect(parseAccessRoles(['manager', 'user:42', 'superuser'])).toEqual(['manager']);
  });
});

describe('parseAccessUsers', () => {
  it('extracts ids from user tokens in the stored audience', () => {
    expect(parseAccessUsers(['manager', 'user:42', 'user:7'])).toEqual([42, 7]);
  });

  it('accepts a bare number[] (the create/update payload shape)', () => {
    expect(parseAccessUsers([42, 7, 42])).toEqual([42, 7]);
  });

  it('parses a JSON-string column value and dedupes', () => {
    expect(parseAccessUsers('["user:5","user:5","qa"]')).toEqual([5]);
  });

  it('returns [] for null / role-only / invalid input', () => {
    expect(parseAccessUsers(null)).toEqual([]);
    expect(parseAccessUsers(['manager', 'qa'])).toEqual([]);
    expect(parseAccessUsers(['user:0', 'user:-3', 'user:x'])).toEqual([]);
  });

  it('userToken builds the canonical stored token', () => {
    expect(userToken(42)).toBe('user:42');
  });
});

describe('role helpers', () => {
  it('normalizeRole lowercases and trims', () => {
    expect(normalizeRole(' QA ')).toBe('qa');
    expect(normalizeRole(null)).toBe('');
  });

  it('isValidRoleKey recognises the canonical keys only', () => {
    expect(isValidRoleKey('manager')).toBe(true);
    expect(isValidRoleKey('superuser')).toBe(false);
  });
});

describe('isInternalForm', () => {
  it('is true only when access_mode = INTERNAL', () => {
    expect(isInternalForm({ access_mode: INTERNAL_MODE })).toBe(true);
    expect(isInternalForm({ access_mode: null })).toBe(false);
    expect(isInternalForm(null)).toBe(false);
  });
});

describe('canAccessInternalForm', () => {
  it('always allows normal (non-internal) forms', () => {
    expect(canAccessInternalForm('csr', { access_mode: null })).toBe(true);
  });

  it('admin can access any Internal form regardless of audience', () => {
    expect(canAccessInternalForm('admin', { access_mode: INTERNAL_MODE, access_roles: [] })).toBe(true);
  });

  it('gates Internal forms on the per-form audience', () => {
    const form = { access_mode: INTERNAL_MODE, access_roles: ['manager', 'qa'] };
    expect(canAccessInternalForm('qa', form)).toBe(true);
    expect(canAccessInternalForm('QA', form)).toBe(true);
    expect(canAccessInternalForm('trainer', form)).toBe(false);
    expect(canAccessInternalForm('csr', form)).toBe(false);
  });

  it('grants access to an individually-named user even when their role is not in the audience', () => {
    // Audience = one specific manager (id 42), no role grants.
    const form = { access_mode: INTERNAL_MODE, access_roles: ['user:42'] };
    expect(canAccessInternalForm('manager', form, 42)).toBe(true);   // the named manager
    expect(canAccessInternalForm('manager', form, 99)).toBe(false);  // a different manager
    expect(canAccessInternalForm('manager', form)).toBe(false);      // no id supplied
  });

  it('honours a user grant combined with role grants', () => {
    const form = { access_mode: INTERNAL_MODE, access_roles: ['qa', 'user:42'] };
    expect(canAccessInternalForm('qa', form, 1)).toBe(true);         // by role
    expect(canAccessInternalForm('manager', form, 42)).toBe(true);   // by individual grant
    expect(canAccessInternalForm('trainer', form, 5)).toBe(false);
  });
});
