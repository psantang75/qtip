/**
 * Missed Opportunity rule sets — the DB-backed policy that tells the model what
 * counts as a miss and how to coach the fix. Edited from the report's Settings
 * tab (admin only); read once per worker run.
 *
 * Deliberately async and uncached, unlike RulePackService: there is exactly one
 * read per nightly run and one per Settings-tab load, so the cache-plus-refresh
 * machinery that service needs for its 8 synchronous prompt-builder call sites
 * would be pure overhead here.
 *
 * `renderRulesForPrompt` mirrors `rulePackService.renderPacksForPrompt`: each
 * rule becomes a labeled block so the model can attribute a finding back to the
 * rule that produced it, which is what makes `rule_key` on the finding row
 * trustworthy.
 */
import prisma from '../../../config/prisma';
import { MissedOpportunityRule, MissedOpportunitySeverity, isSeverity } from './types';

/** Rule row as the Settings tab needs it — includes admin bookkeeping. */
export interface MissedOpportunityRuleRow extends MissedOpportunityRule {
  rule_id: number;
  is_active: boolean;
  sort_order: number;
  updated_by: number | null;
  updated_at: string;
}

const RULE_KEY_RE = /^[a-z][a-z0-9_]{2,63}$/;

function toRow(r: {
  rule_id: number;
  rule_key: string;
  rule_name: string;
  category: string;
  severity: string;
  body_md: string;
  guidance_md: string | null;
  is_active: boolean;
  is_omission: boolean;
  sort_order: number;
  updated_by: number | null;
  updated_at: Date;
}): MissedOpportunityRuleRow {
  return {
    rule_id: r.rule_id,
    rule_key: r.rule_key,
    rule_name: r.rule_name,
    category: r.category,
    severity: (isSeverity(r.severity) ? r.severity : 'medium') as MissedOpportunitySeverity,
    body_md: r.body_md,
    guidance_md: r.guidance_md,
    is_active: r.is_active,
    is_omission: r.is_omission,
    sort_order: r.sort_order,
    updated_by: r.updated_by,
    updated_at: r.updated_at.toISOString(),
  };
}

/** Every rule, active first by sort order — what the Settings tab renders. */
export async function listRules(): Promise<MissedOpportunityRuleRow[]> {
  const rows = await prisma.ieMissedOpportunityRule.findMany({
    orderBy: [{ sort_order: 'asc' }, { rule_id: 'asc' }],
  });
  return rows.map(toRow);
}

/** Only the active rules, in the order they will be rendered into the prompt. */
export async function listActiveRules(): Promise<MissedOpportunityRule[]> {
  const rows = await prisma.ieMissedOpportunityRule.findMany({
    where: { is_active: true },
    orderBy: [{ sort_order: 'asc' }, { rule_id: 'asc' }],
  });
  return rows.map(toRow);
}

export interface RuleWriteInput {
  rule_key?: string;
  rule_name?: string;
  category?: string;
  severity?: MissedOpportunitySeverity;
  body_md?: string;
  guidance_md?: string | null;
  is_active?: boolean;
  is_omission?: boolean;
  sort_order?: number;
}

/** Creates a rule. rule_key is immutable once set — findings reference it. */
export async function createRule(
  input: RuleWriteInput,
  updatedBy: number | null,
): Promise<MissedOpportunityRuleRow> {
  const key = (input.rule_key ?? '').trim();
  if (!RULE_KEY_RE.test(key)) {
    throw new Error('Rule key must be 3-64 lowercase letters, digits, or underscores and start with a letter');
  }
  const name = (input.rule_name ?? '').trim();
  const body = (input.body_md ?? '').trim();
  if (!name) throw new Error('Rule name is required');
  if (!body) throw new Error('Rule body is required — it is what the model looks for');

  const existing = await prisma.ieMissedOpportunityRule.findUnique({ where: { rule_key: key } });
  if (existing) throw new Error(`A rule with key "${key}" already exists`);

  const created = await prisma.ieMissedOpportunityRule.create({
    data: {
      rule_key: key,
      rule_name: name,
      category: (input.category ?? 'Other').trim() || 'Other',
      severity: input.severity ?? 'medium',
      body_md: body,
      guidance_md: input.guidance_md?.trim() || null,
      is_active: input.is_active ?? true,
      // Audited unless the author says otherwise: an audited rule can lose a
      // false positive, an unaudited one cannot.
      is_omission: input.is_omission ?? true,
      sort_order: input.sort_order ?? 100,
      updated_by: updatedBy,
    },
  });
  return toRow(created);
}

/**
 * Updates an existing rule. `rule_key` is intentionally not patchable: stored
 * findings carry the key, so renaming it would orphan history.
 */
export async function updateRule(
  ruleId: number,
  input: RuleWriteInput,
  updatedBy: number | null,
): Promise<MissedOpportunityRuleRow> {
  if (!Number.isInteger(ruleId) || ruleId <= 0) throw new Error('Invalid rule id');
  const existing = await prisma.ieMissedOpportunityRule.findUnique({ where: { rule_id: ruleId } });
  if (!existing) throw new Error('Rule not found');

  const data: Record<string, unknown> = { updated_by: updatedBy };
  if (input.rule_name !== undefined) {
    const name = input.rule_name.trim();
    if (!name) throw new Error('Rule name cannot be empty');
    data.rule_name = name;
  }
  if (input.body_md !== undefined) {
    const body = input.body_md.trim();
    if (!body) throw new Error('Rule body cannot be empty');
    data.body_md = body;
  }
  if (input.category !== undefined) data.category = input.category.trim() || 'Other';
  if (input.severity !== undefined) data.severity = input.severity;
  if (input.guidance_md !== undefined) data.guidance_md = input.guidance_md?.trim() || null;
  if (input.is_active !== undefined) data.is_active = input.is_active;
  if (input.is_omission !== undefined) data.is_omission = input.is_omission;
  if (input.sort_order !== undefined) data.sort_order = input.sort_order;

  const updated = await prisma.ieMissedOpportunityRule.update({
    where: { rule_id: ruleId },
    data,
  });
  return toRow(updated);
}

/**
 * Renders the active rules as one block of system-prompt text. Each rule is
 * labeled with the exact `rule_key` the model must echo back so a finding can
 * be traced to the rule that produced it.
 */
export function renderRulesForPrompt(rules: MissedOpportunityRule[]): string {
  if (rules.length === 0) return '';
  const parts = rules.map((r) => {
    const lines = [
      `RULE ${r.rule_key} — ${r.rule_name} (category: ${r.category}, default severity: ${r.severity})`,
      `WHAT COUNTS AS THIS MISS: ${r.body_md.trim()}`,
    ];
    const guidance = r.guidance_md?.trim();
    if (guidance) lines.push(`HOW TO COACH THE FIX: ${guidance}`);
    return lines.join('\n');
  });
  return parts.join('\n\n');
}
