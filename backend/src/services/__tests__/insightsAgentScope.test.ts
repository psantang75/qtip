import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { areaDeptGuard, currentEmployeeJoin, AGENT_ROLE, SALES_DEPT_ROOT_PATH } from '../insightsAgentScope';

describe('areaDeptGuard', () => {
  it('reads csr as the complement of the sales subtree', () => {
    const g = areaDeptGuard('csr');
    expect(g.sql).toContain("COALESCE(dpt.hierarchy_path, '') <> ?");
    expect(g.sql).toContain('NOT LIKE');
    expect(g.params).toEqual([SALES_DEPT_ROOT_PATH, SALES_DEPT_ROOT_PATH]);
  });

  it('reads sales as the subtree root plus descendants', () => {
    const g = areaDeptGuard('sales');
    expect(g.sql).toContain('dpt.hierarchy_path = ?');
    expect(g.sql).toContain("LIKE CONCAT(?, '/%')");
  });

  it('honours a custom department alias', () => {
    expect(areaDeptGuard('csr', 'd2').sql).toContain('d2.hierarchy_path');
  });

  it('exposes CSR as the only agent role', () => {
    expect(AGENT_ROLE).toBe('CSR');
  });
});

describe('currentEmployeeJoin', () => {
  it('hops fact -> its own row -> that user current row', () => {
    const sql = currentEmployeeJoin();
    // The fact binds to the row it was stamped with, by surrogate key...
    expect(sql).toContain('JOIN ie_dim_employee fe ON fe.employee_key = f.employee_key');
    // ...and the readable alias is reached by BUSINESS key off that row.
    expect(sql).toContain('JOIN ie_dim_employee e ON e.is_current = 1 AND e.user_id = fe.user_id');
  });

  it('never constrains is_current on the version alias', () => {
    // Filtering is_current on the fact-side hop is the bug this helper exists to
    // prevent: it drops every row loaded before the employee's latest change.
    const sql = currentEmployeeJoin();
    expect(sql).not.toContain('fe.is_current');
    expect(sql).not.toMatch(/e\.is_current = 1 AND e\.employee_key = f\.employee_key/);
  });

  it('applies is_current exactly once, on the current alias', () => {
    expect(currentEmployeeJoin().match(/is_current/g)).toHaveLength(1);
  });

  it('supports a custom fact alias and column', () => {
    const sql = currentEmployeeJoin({ factAlias: 'ca' });
    expect(sql).toContain('fe.employee_key = ca.employee_key');

    const explicit = currentEmployeeJoin({ factAlias: 'd', factColumn: 'd.employee_key' });
    expect(explicit).toContain('fe.employee_key = d.employee_key');
  });

  it('supports custom aliases without collision', () => {
    const sql = currentEmployeeJoin({ alias: 'emp', versionAlias: 'empv' });
    expect(sql).toContain('ie_dim_employee empv ON empv.employee_key = f.employee_key');
    expect(sql).toContain('ie_dim_employee emp ON emp.is_current = 1 AND emp.user_id = empv.user_id');
  });

  it('makes BOTH hops LEFT so an unmatched fact row still survives', () => {
    // One inner hop would defeat the point of a LEFT join reader.
    const sql = currentEmployeeJoin({ left: true });
    expect(sql.match(/LEFT JOIN/g)).toHaveLength(2);
    expect(sql).not.toMatch(/(^|\n)\s*JOIN /);
  });

  it('appends an extra predicate to the current row only', () => {
    const sql = currentEmployeeJoin({ extra: 'e.is_active = 1' });
    const [versionHop, currentHop] = sql.split('\n');
    expect(versionHop).not.toContain('is_active');
    expect(currentHop).toContain('AND e.is_active = 1');
  });
});

describe('no reader reintroduces the Type-2-unsafe employee join', () => {
  // ie_dim_employee is Type-2: a department/role/title/manager/active change
  // closes the row and mints a NEW employee_key, while facts keep the key that
  // was current when they were loaded. Joining is_current directly against
  // f.employee_key therefore silently drops that person's whole history. This
  // once hid 1,550 of 5,397 ie_fact_call_activity rows (29%). Keep it out.
  const SERVICES = path.resolve(__dirname, '..');

  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === '__tests__' ? [] : walk(full);
      return entry.name.endsWith('.ts') ? [full] : [];
    });

  const UNSAFE = /is_current\s*=\s*1[^\n]*?\.employee_key\s*=\s*\w+\.employee_key/;

  // Comments are allowed to quote the anti-pattern — that is how it stays
  // documented — so only the executable text is scanned.
  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it.each(walk(SERVICES).map((f) => path.relative(SERVICES, f)))('%s', (rel) => {
    const src = stripComments(fs.readFileSync(path.join(SERVICES, rel), 'utf8'));
    expect(src).not.toMatch(UNSAFE);
  });
});
