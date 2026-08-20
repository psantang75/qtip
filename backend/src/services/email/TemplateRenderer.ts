import Handlebars from 'handlebars';
import path from 'path';
import fs from 'fs';
import prisma from '../../config/prisma';
import { mailConfig } from '../../config/environment';
import logger from '../../config/logger';

/**
 * Handlebars-based renderer with DB-first / filesystem-fallback lookup.
 *
 * Pipeline:
 *   1. If an `email_templates` row for `template_key` exists and
 *      `is_enabled = 1`, use its subject + body_html.
 *   2. Otherwise fall back to `templates/<template_key>.hbs` on disk so
 *      the system can boot before the seed has run (and so admins can
 *      always "reset to default" by clearing the DB row).
 *
 * Shared partials (`layout`, `header`, `footer`, `button`, `field-row`,
 * `digest-item`) are loaded once at construction and registered with
 * Handlebars. Helpers handle date formatting, currency, deep-link
 * construction (uses APP_BASE_URL), and pluralization.
 *
 * The renderer does NOT validate variables at send time — it leaves
 * unknown handlebars expressions as empty strings rather than crashing
 * a write-up sign because someone misnamed `{{csr.name}}`. Validation
 * happens at admin-save time via `validateTemplate()`.
 */

const TEMPLATES_DIR = path.resolve(__dirname, 'templates');
const PARTIALS_DIR = path.join(TEMPLATES_DIR, 'partials');

let initialized = false;
const templateCache = new Map<string, HandlebarsTemplateDelegate>();
const subjectCache = new Map<string, HandlebarsTemplateDelegate>();

function initIfNeeded(): void {
  if (initialized) return;
  initialized = true;

  Handlebars.registerHelper('formatDate', (value: Date | string | undefined) => {
    if (!value) return '';
    try {
      const d = new Date(value);
      return d.toLocaleDateString('en-US', {
        timeZone: mailConfig.timezone,
        year: 'numeric', month: 'short', day: 'numeric',
      });
    } catch { return String(value); }
  });

  Handlebars.registerHelper('formatDateTime', (value: Date | string | undefined) => {
    if (!value) return '';
    try {
      const d = new Date(value);
      return d.toLocaleString('en-US', {
        timeZone: mailConfig.timezone,
        year: 'numeric', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit',
      });
    } catch { return String(value); }
  });

  Handlebars.registerHelper('appUrl', (path: string) => {
    if (!path) return mailConfig.appBaseUrl;
    const base = mailConfig.appBaseUrl;
    const p = path.startsWith('/') ? path : `/${path}`;
    return `${base}${p}`;
  });

  Handlebars.registerHelper('plural', (count: number, singular: string, plural: string) =>
    count === 1 ? singular : plural,
  );

  Handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);
  Handlebars.registerHelper('gt', (a: number, b: number) => Number(a) > Number(b));

  if (fs.existsSync(PARTIALS_DIR)) {
    for (const file of fs.readdirSync(PARTIALS_DIR)) {
      if (!file.endsWith('.hbs')) continue;
      const name = file.replace(/\.hbs$/, '');
      const src = fs.readFileSync(path.join(PARTIALS_DIR, file), 'utf8');
      Handlebars.registerPartial(name, src);
    }
  }
}

function compileSubject(key: string, src: string): HandlebarsTemplateDelegate {
  if (subjectCache.has(key)) return subjectCache.get(key)!;
  const fn = Handlebars.compile(src, { noEscape: false, strict: false });
  subjectCache.set(key, fn);
  return fn;
}

function compileBody(key: string, src: string): HandlebarsTemplateDelegate {
  if (templateCache.has(key)) return templateCache.get(key)!;
  const fn = Handlebars.compile(src, { noEscape: false, strict: false });
  templateCache.set(key, fn);
  return fn;
}

function readFileTemplate(key: string): string | null {
  const file = path.join(TEMPLATES_DIR, `${key}.hbs`);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8');
}

export interface RenderedEmail {
  subject: string;
  html: string;
  cadence: 'IMMEDIATE' | 'DAILY' | 'WEEKLY';
  isEnabled: boolean;
  isLocked: boolean;
  digestFilter: 'ALL' | 'BELOW_THRESHOLD' | 'ROUTED_TO_QA';
  source: 'db' | 'file';
}

export interface RenderInput {
  templateKey: string;
  data: Record<string, unknown>;
}

/**
 * Looks up the template, renders subject + body. Returns null when no
 * template (DB nor file) exists — caller should treat as misconfiguration.
 */
export async function renderTemplate(input: RenderInput): Promise<RenderedEmail | null> {
  initIfNeeded();
  const { templateKey, data } = input;

  const dbTemplate = await prisma.emailTemplate.findUnique({
    where: { template_key: templateKey },
  });

  let subjectSrc: string;
  let bodySrc: string;
  let cadence: 'IMMEDIATE' | 'DAILY' | 'WEEKLY' = 'IMMEDIATE';
  let isEnabled = true;
  let isLocked = false;
  let digestFilter: 'ALL' | 'BELOW_THRESHOLD' | 'ROUTED_TO_QA' = 'ALL';
  let source: 'db' | 'file' = 'file';

  if (dbTemplate) {
    subjectSrc = dbTemplate.subject;
    bodySrc = dbTemplate.body_html;
    cadence = dbTemplate.cadence as any;
    isEnabled = !!dbTemplate.is_enabled;
    isLocked = !!dbTemplate.is_locked;
    digestFilter = dbTemplate.digest_filter as any;
    source = 'db';
  } else {
    const fileBody = readFileTemplate(templateKey);
    if (!fileBody) {
      logger.warn('[TemplateRenderer] no template found', { templateKey });
      return null;
    }
    const fileSubject = readFileTemplate(`${templateKey}.subject`);
    subjectSrc = fileSubject ?? `[QTIP] ${templateKey}`;
    bodySrc = fileBody;
  }

  // Render: layout partial wraps body so file templates only need the body.
  const fullBodySrc = bodySrc.includes('{{> layout') || bodySrc.includes('{{>layout')
    ? bodySrc
    : `{{#> layout}}${bodySrc}{{/layout}}`;

  const subject = compileSubject(`s:${templateKey}:${dbTemplate?.version ?? 'fs'}`, subjectSrc)(data);
  const html = compileBody(`b:${templateKey}:${dbTemplate?.version ?? 'fs'}`, fullBodySrc)(data);

  return { subject, html, cadence, isEnabled, isLocked, digestFilter, source };
}

/**
 * Validates that a template's subject/body only references variables in
 * `allowedVariables`. Returns the list of bad references (empty = OK).
 *
 * Called from the admin save endpoint so editors get immediate feedback,
 * not a runtime template error six hours later when an event fires.
 */
export function validateTemplate(
  subject: string,
  bodyHtml: string,
  allowedVariables: string[],
): string[] {
  const allowed = new Set(allowedVariables.map(v => v.split('.')[0]));
  // Always-available helpers/partials/auto-injected vars
  for (const builtin of [
    'appUrl', 'formatDate', 'formatDateTime', 'plural', 'eq', 'gt',
    'else', 'if', 'unless', 'each', 'with', 'this',
    '@root', '@key', '@index', '@first', '@last',
    // Auto-injected by NotificationService on every send
    'recipient', 'deepLinkPath', 'eventEntityLabel',
    // Layout / partials
    'layout', 'header', 'footer', 'button', 'else',
  ]) {
    allowed.add(builtin);
  }
  const re = /\{\{\s*[#\/]?\s*([A-Za-z0-9_]+)/g;
  const bad = new Set<string>();
  for (const src of [subject, bodyHtml]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const tok = m[1];
      if (!allowed.has(tok)) bad.add(tok);
    }
  }
  return Array.from(bad);
}

/** For tests / admin "preview" endpoint with arbitrary template content. */
export function renderInline(
  subjectSrc: string,
  bodyHtmlSrc: string,
  data: Record<string, unknown>,
): { subject: string; html: string } {
  initIfNeeded();
  const fullBody = bodyHtmlSrc.includes('{{> layout') || bodyHtmlSrc.includes('{{>layout')
    ? bodyHtmlSrc
    : `{{#> layout}}${bodyHtmlSrc}{{/layout}}`;
  const subject = Handlebars.compile(subjectSrc, { strict: false })(data);
  const html = Handlebars.compile(fullBody, { strict: false })(data);
  return { subject, html };
}

export function clearTemplateCache(templateKey?: string): void {
  if (!templateKey) {
    templateCache.clear();
    subjectCache.clear();
    return;
  }
  for (const key of Array.from(templateCache.keys())) {
    if (key.includes(`:${templateKey}:`)) templateCache.delete(key);
  }
  for (const key of Array.from(subjectCache.keys())) {
    if (key.includes(`:${templateKey}:`)) subjectCache.delete(key);
  }
}

export function getTemplatesDir(): string {
  return TEMPLATES_DIR;
}

export function readSeedTemplate(templateKey: string): { subject: string; body: string } | null {
  const body = readFileTemplate(templateKey);
  if (!body) return null;
  const subjectFile = readFileTemplate(`${templateKey}.subject`);
  return { subject: subjectFile ?? `[QTIP] ${templateKey}`, body };
}
