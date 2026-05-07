import { describe, it, expect, vi } from 'vitest';

// Stub Prisma so the import graph doesn't load the real client.
vi.mock('../../../config/prisma', () => ({
  default: { emailTemplate: { findUnique: vi.fn() } },
}));

import { validateTemplate, renderInline } from '../TemplateRenderer';

describe('TemplateRenderer.validateTemplate', () => {
  it('passes when only allowed variables are referenced', () => {
    const bad = validateTemplate('Hi {{user.username}}', '<p>Hello {{user.username}}</p>', ['user']);
    expect(bad).toEqual([]);
  });

  it('flags references that are not in the allowlist', () => {
    const bad = validateTemplate(
      'Hi {{user.username}}',
      '<p>{{forbidden.thing}} and {{notAllowed}}</p>',
      ['user'],
    );
    expect(bad.sort()).toEqual(['forbidden', 'notAllowed'].sort());
  });

  it('always allows built-in helpers like if/each/recipient/appUrl', () => {
    const bad = validateTemplate(
      '{{#if cond}}{{else}}{{/if}}',
      '{{#each items}}<p>{{this.name}}</p>{{/each}}{{recipient.username}} {{appUrl path}}',
      ['cond', 'items', 'path'],
    );
    expect(bad).toEqual([]);
  });
});

describe('TemplateRenderer.renderInline', () => {
  it('substitutes Handlebars expressions and wraps the body in the layout partial', () => {
    const out = renderInline('Welcome {{user.username}}', '<p>Hi {{user.username}}</p>', { user: { username: 'pete' } });
    expect(out.subject).toBe('Welcome pete');
    expect(out.html).toContain('Hi pete');
  });
});
