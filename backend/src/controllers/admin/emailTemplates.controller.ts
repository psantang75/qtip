import { Request, Response } from 'express';
import prisma from '../../config/prisma';
import logger from '../../config/logger';
import emailService from '../../services/email/EmailService';
import {
  renderInline, renderTemplate, validateTemplate, clearTemplateCache, readSeedTemplate,
} from '../../services/email/TemplateRenderer';
import { logEmail } from '../../services/email/EmailLogger';
import { resendKey } from '../../services/notifications/idempotency';
import {
  TEMPLATE_SEED_SPECS, ROLE_LABELS, getTemplateSpec, type RoleToken,
} from '../../services/email/templateSeeds';
import { getState as getCircuitState } from '../../services/notifications/circuitBreaker';

/**
 * Admin endpoints for /admin/email-templates. All require Admin role
 * (enforced at the route level via existing role-gate middleware).
 *
 * GET    /api/admin/email-templates                 list
 * GET    /api/admin/email-templates/:id             detail (incl. version history)
 * PUT    /api/admin/email-templates/:id             save (creates a new version row)
 * POST   /api/admin/email-templates/:id/preview     render with sample data
 * POST   /api/admin/email-templates/:id/test-send   send a one-off to a test inbox
 * POST   /api/admin/email-templates/:id/reset       restore filesystem default
 * POST   /api/admin/email-templates/:id/rollback    swap to an earlier version row
 * GET    /api/admin/email-templates/_health         transport + circuit status
 * GET    /api/admin/email-templates/_recent-sends   tail of email_log (paged)
 * POST   /api/admin/email-templates/_resend/:logId  resend a single message
 */

/**
 * Decorate a template row with the spec-driven, non-editable hints the
 * frontend needs (role labels, fixed-role list, digest eligibility).
 * Keeps the DB row a clean source of truth for editable fields only.
 */
function decorateTemplate(tpl: any) {
  const spec = getTemplateSpec(tpl.template_key);
  return {
    ...tpl,
    role_labels: ROLE_LABELS,
    fixed_roles: spec?.fixed_roles ?? [],
    digest_eligible: spec?.digest_eligible ?? true,
  };
}

export const listTemplates = async (_req: Request, res: Response) => {
  const rows = await prisma.emailTemplate.findMany({
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  });
  res.json({ templates: rows.map(decorateTemplate) });
};

export const getTemplate = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ message: 'Invalid template id' });
  const tpl = await prisma.emailTemplate.findUnique({ where: { id } });
  if (!tpl) return res.status(404).json({ message: 'Template not found' });
  const versions = await prisma.emailTemplateVersion.findMany({
    where: { template_id: id },
    orderBy: { version: 'desc' },
    take: 25,
    include: { editor: { select: { id: true, username: true } } },
  });
  return res.json({ template: decorateTemplate(tpl), versions });
};

export const updateTemplate = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ message: 'Invalid template id' });
  const tpl = await prisma.emailTemplate.findUnique({ where: { id } });
  if (!tpl) return res.status(404).json({ message: 'Template not found' });

  const editorId = req.user?.user_id ?? null;
  const body = req.body ?? {};
  const subject = String(body.subject ?? tpl.subject);
  const bodyHtml = String(body.body_html ?? tpl.body_html);
  const bodyText = body.body_text ?? tpl.body_text;
  const cadence = (body.cadence ?? tpl.cadence) as 'IMMEDIATE' | 'DAILY' | 'WEEKLY';
  const digestFilter = (body.digest_filter ?? tpl.digest_filter) as 'ALL' | 'BELOW_THRESHOLD' | 'ROUTED_TO_QA';
  const isEnabled = tpl.is_locked ? true : (body.is_enabled ?? tpl.is_enabled);

  const allowed = (tpl.allowed_variables as unknown as string[]) ?? [];
  const badVars = validateTemplate(subject, bodyHtml, allowed);
  if (badVars.length > 0) {
    return res.status(400).json({
      message: `Unknown variables: ${badVars.join(', ')}. Allowed: ${allowed.join(', ')}.`,
      bad_variables: badVars,
    });
  }

  // Recipient roles: validate against the spec's available_roles and
  // ensure fixed_roles stay enabled. Skip when the field isn't supplied
  // (means: don't change recipients on this save).
  let recipientRoles: RoleToken[] | undefined;
  if (Array.isArray(body.recipient_roles)) {
    const spec = getTemplateSpec(tpl.template_key);
    const availableRoles = (tpl.available_roles as unknown as RoleToken[])
      ?? spec?.available_roles ?? [];
    const fixedRoles = spec?.fixed_roles ?? [];
    const submitted = (body.recipient_roles as unknown[])
      .map(v => String(v) as RoleToken)
      .filter(v => availableRoles.includes(v));
    // Re-add any fixed roles the client tried to drop.
    for (const f of fixedRoles) if (!submitted.includes(f)) submitted.push(f);
    recipientRoles = submitted;
  }

  // Snapshot current version before overwriting.
  await prisma.emailTemplateVersion.create({
    data: {
      template_id: tpl.id,
      version: tpl.version,
      subject: tpl.subject,
      body_html: tpl.body_html,
      body_text: tpl.body_text,
      cadence: tpl.cadence,
      digest_filter: tpl.digest_filter,
      is_enabled: tpl.is_enabled,
      edited_by: editorId,
    },
  });

  const updated = await prisma.emailTemplate.update({
    where: { id },
    data: {
      subject, body_html: bodyHtml, body_text: bodyText,
      cadence, digest_filter: digestFilter, is_enabled: isEnabled,
      version: tpl.version + 1,
      updated_by: editorId,
      ...(recipientRoles !== undefined ? { recipient_roles: recipientRoles as any } : {}),
    },
  });
  clearTemplateCache(updated.template_key);
  res.json({ template: decorateTemplate(updated) });
};

export const previewTemplate = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ message: 'Invalid template id' });
  const tpl = await prisma.emailTemplate.findUnique({ where: { id } });
  if (!tpl) return res.status(404).json({ message: 'Template not found' });

  const subjectSrc = String(req.body?.subject ?? tpl.subject);
  const bodySrc = String(req.body?.body_html ?? tpl.body_html);
  const data = req.body?.data ?? sampleData(tpl.template_key);
  try {
    const out = renderInline(subjectSrc, bodySrc, data);
    res.json(out);
  } catch (err: any) {
    res.status(400).json({ message: err?.message || 'Render failed' });
  }
};

export const testSendTemplate = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const to = String(req.body?.to ?? '').trim();
  if (!Number.isFinite(id)) return res.status(400).json({ message: 'Invalid template id' });
  if (!to) return res.status(400).json({ message: '"to" is required' });

  const tpl = await prisma.emailTemplate.findUnique({ where: { id } });
  if (!tpl) return res.status(404).json({ message: 'Template not found' });

  const data = req.body?.data ?? sampleData(tpl.template_key);
  const rendered = await renderTemplate({ templateKey: tpl.template_key, data });
  if (!rendered) return res.status(500).json({ message: 'Failed to render template' });

  const result = await emailService.send({
    to, subject: `[TEST] ${rendered.subject}`,
    html: rendered.html,
    templateKey: `${tpl.template_key}:test`,
  });
  await logEmail({
    templateKey: tpl.template_key, toEmail: to, toUserId: req.user?.user_id ?? null,
    subject: `[TEST] ${rendered.subject}`,
    status: result.ok ? 'SENT' : 'FAILED',
    messageId: result.messageId, errorMessage: result.error,
    dedupeKey: `test:${tpl.template_key}:${Date.now()}:${to}`,
    sentAt: result.ok ? new Date() : null,
  });
  res.json(result);
};

export const resetTemplate = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ message: 'Invalid template id' });
  const tpl = await prisma.emailTemplate.findUnique({ where: { id } });
  if (!tpl) return res.status(404).json({ message: 'Template not found' });
  const seed = readSeedTemplate(tpl.template_key);
  if (!seed) return res.status(400).json({ message: 'No filesystem default exists for this template' });
  const spec = TEMPLATE_SEED_SPECS.find(s => s.template_key === tpl.template_key);
  await prisma.emailTemplateVersion.create({
    data: {
      template_id: tpl.id, version: tpl.version,
      subject: tpl.subject, body_html: tpl.body_html, body_text: tpl.body_text,
      cadence: tpl.cadence, digest_filter: tpl.digest_filter, is_enabled: tpl.is_enabled,
      edited_by: req.user?.user_id ?? null,
    },
  });
  const updated = await prisma.emailTemplate.update({
    where: { id },
    data: {
      subject: seed.subject.trim(),
      body_html: seed.body,
      body_text: null,
      cadence: spec?.cadence ?? 'IMMEDIATE',
      digest_filter: 'ALL',
      is_enabled: true,
      recipient_roles: spec?.default_recipient_roles as any ?? (tpl.recipient_roles as any),
      version: tpl.version + 1,
      updated_by: req.user?.user_id ?? null,
    },
  });
  clearTemplateCache(updated.template_key);
  res.json({ template: decorateTemplate(updated) });
};

export const rollbackTemplate = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const versionId = Number(req.body?.version_id);
  if (!Number.isFinite(id) || !Number.isFinite(versionId)) {
    return res.status(400).json({ message: 'Invalid template or version id' });
  }
  const tpl = await prisma.emailTemplate.findUnique({ where: { id } });
  const ver = await prisma.emailTemplateVersion.findUnique({ where: { id: versionId } });
  if (!tpl || !ver || ver.template_id !== id) {
    return res.status(404).json({ message: 'Template version not found' });
  }
  await prisma.emailTemplateVersion.create({
    data: {
      template_id: tpl.id, version: tpl.version,
      subject: tpl.subject, body_html: tpl.body_html, body_text: tpl.body_text,
      cadence: tpl.cadence, digest_filter: tpl.digest_filter, is_enabled: tpl.is_enabled,
      edited_by: req.user?.user_id ?? null,
    },
  });
  const updated = await prisma.emailTemplate.update({
    where: { id },
    data: {
      subject: ver.subject, body_html: ver.body_html, body_text: ver.body_text,
      cadence: ver.cadence, digest_filter: ver.digest_filter, is_enabled: ver.is_enabled,
      version: tpl.version + 1,
      updated_by: req.user?.user_id ?? null,
    },
  });
  clearTemplateCache(updated.template_key);
  res.json({ template: decorateTemplate(updated) });
};

export const getEmailHealth = async (_req: Request, res: Response) => {
  const transport = await emailService.verify();
  const circuit = getCircuitState();
  const last24h = await prisma.emailLog.groupBy({
    by: ['status'],
    where: { created_at: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    _count: { _all: true },
  });
  res.json({
    configured: emailService.isConfigured(),
    dryRun: emailService.isDryRun(),
    transport,
    circuit,
    last24h,
  });
};

export const getRecentSends = async (req: Request, res: Response) => {
  const take = Math.min(200, Math.max(10, parseInt(String(req.query.limit ?? '50'), 10) || 50));
  const status = req.query.status ? String(req.query.status) : undefined;
  const templateKey = req.query.template_key ? String(req.query.template_key) : undefined;
  const where: any = {};
  if (status) where.status = status;
  if (templateKey) where.template_key = templateKey;
  const rows = await prisma.emailLog.findMany({
    where, orderBy: { created_at: 'desc' }, take,
    include: { to_user: { select: { id: true, username: true } } },
  });
  res.json({ rows });
};

export const resendLogged = async (req: Request, res: Response) => {
  const logId = Number(req.params.logId);
  if (!Number.isFinite(logId)) return res.status(400).json({ message: 'Invalid log id' });
  const row = await prisma.emailLog.findUnique({ where: { id: logId } });
  if (!row) return res.status(404).json({ message: 'Log row not found' });
  const data = sampleData(row.template_key);
  const rendered = await renderTemplate({ templateKey: row.template_key, data });
  if (!rendered) return res.status(400).json({ message: 'Template no longer exists' });
  const result = await emailService.send({
    to: row.to_email,
    subject: `[RESEND] ${rendered.subject}`,
    html: rendered.html,
    templateKey: row.template_key,
  });
  await logEmail({
    templateKey: row.template_key, toEmail: row.to_email, toUserId: row.to_user_id,
    subject: `[RESEND] ${rendered.subject}`,
    status: result.ok ? 'SENT' : 'FAILED',
    messageId: result.messageId, errorMessage: result.error,
    dedupeKey: resendKey(row.dedupe_key),
    relatedEntityType: row.related_entity_type, relatedEntityId: row.related_entity_id,
    sentAt: result.ok ? new Date() : null,
  });
  res.json(result);
};

/**
 * Stable sample data per template_key for preview / test-send flows.
 * Keeps the admin from seeing literal {{recipient.username}} in the
 * preview and means "Send test" produces a realistic email.
 */
function sampleData(templateKey: string): Record<string, unknown> {
  const baseUser = {
    id: 1, username: 'sample.user', email: 'sample@example.com',
    roleLabel: 'the agent (CSR)', matchedRole: 'agent',
  };
  const baseSubmission = {
    id: 9999, total_score: 87, ai_overall_confidence: 0.62,
    critical_fail_count: 1, status: 'FINALIZED', submitted_at: new Date(),
  };
  const baseForm = {
    id: 1, form_name: 'Sample Form',
    pass_threshold: 80, ai_sample_low_confidence_threshold: 0.7,
  };
  const baseWriteup = {
    id: 42, document_type: 'Coaching Letter',
    meeting_date: new Date(), signed_at: new Date(), refused_at: new Date(),
    duration_minutes: 30, location: 'Conference Room B',
    signature_due_date: new Date(Date.now() + 48 * 60 * 60 * 1000),
    refusal_reason: 'Disagreed with characterization',
    follow_up_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    followup_type: '1:1 check-in',
  };
  const baseSession = {
    id: 7, session_date: new Date(),
    coaching_format: 'ONE_ON_ONE', coaching_purpose: 'WEEKLY',
    duration_minutes: 30, location: 'Zoom',
    preparation_notes: 'Review last week\'s call recordings.',
    action_due_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    cancel_reason: 'Coach out sick',
    outcome_summary: 'Agent will work on call openings this week.',
    require_action_plan: true,
  };
  const baseQuiz = { title: 'Refresher: KB articles', question_count: 8, estimated_minutes: 10 };
  const baseDispute = {
    id: 13, status: 'UPHELD', reason: 'The KB article was updated mid-call.',
    resolution_notes: 'Confirmed the call predated the KB update.',
    created_at: new Date(), resolved_at: new Date(),
  };

  if (templateKey.startsWith('auth.')) {
    return {
      user: baseUser, recipient: baseUser, eventEntityLabel: 'account',
      resetUrl: 'https://qtip.dm-us.com/reset-password?token=sample',
      changedAt: new Date(), lockedAt: new Date(),
      unlocksAt: new Date(Date.now() + 15 * 60 * 1000),
      requestedAt: new Date(), requestIp: '10.20.30.40',
      failedAttempts: 5, lastFailedIp: '10.20.30.40',
    };
  }
  if (templateKey.startsWith('submission.') || templateKey.startsWith('ai.')) {
    return {
      form: baseForm, submission: baseSubmission, csr: baseUser, recipient: baseUser,
      reviewer: baseUser, reviewerKind: templateKey.endsWith('_by_ai') ? 'ai' : 'qa',
      routingReason: 'low_confidence',
      routingReasonLabel: 'AI confidence was below the form threshold',
      passLabel: 'passed',
      criticalFailQuestions: [{ text: 'Did the agent verify the caller?' }],
      eventEntityLabel: 'submission',
    };
  }
  if (templateKey.startsWith('dispute.')) {
    return {
      form: baseForm, submission: baseSubmission, dispute: baseDispute,
      csr: baseUser, recipient: baseUser, resolver: baseUser,
      originalScore: 73, disputeDenied: false,
      eventEntityLabel: 'dispute',
    };
  }
  if (templateKey.startsWith('coaching.')) {
    return {
      session: baseSession, csr: baseUser, coach: baseUser, recipient: baseUser,
      quiz: baseQuiz, eventEntityLabel: 'coaching session',
    };
  }
  if (templateKey.startsWith('writeup.')) {
    return {
      writeup: baseWriteup, csr: baseUser, manager: baseUser, hr_witness: baseUser,
      assignee: baseUser, recipient: baseUser,
      employeeRightsReminder: 'You have the right to bring representation to this meeting.',
      witnessSlaDays: 3,
      eventEntityLabel: 'write-up',
    };
  }
  if (templateKey.startsWith('digest.')) {
    return {
      recipient: baseUser, itemCount: 3, hasMore: false,
      avgScore: 87, criticalFailCount: 0, trendLabel: '+2 pts above',
      teamAvg: 89, deltaLabel: '+1.2 pts', disputesOpenedCount: 1,
      topPerformers: [{ csrName: 'a.user', avg: 95, reviews: 8 }],
      needsAttention: [{ csrName: 'b.user', avg: 71, reviews: 6, criticalFails: 2 }],
      items: [
        { formName: 'Phone QA', csrName: 'sample.user', score: 92, status: 'passed' },
        { formName: 'Ticket QA', csrName: 'sample.user', score: 78, status: 'needs review' },
        { formName: 'Email QA', csrName: 'sample.user', score: 88, status: 'passed' },
      ],
      eventEntityLabel: 'digest',
    };
  }
  if (templateKey === 'system.circuit_tripped') {
    return {
      threshold: 1000, count: 1234, trippedAt: new Date(),
      resetsAt: new Date(Date.now() + 5 * 60 * 1000),
      topTemplate: { key: 'submission.audit_finalized_by_ai', count: 980 },
      recipient: baseUser, eventEntityLabel: 'notification',
    };
  }
  return { recipient: baseUser };
}

export default {
  listTemplates, getTemplate, updateTemplate, previewTemplate,
  testSendTemplate, resetTemplate, rollbackTemplate,
  getEmailHealth, getRecentSends, resendLogged,
};

void logger;
