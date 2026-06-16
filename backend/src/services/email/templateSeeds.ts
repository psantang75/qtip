import prisma from '../../config/prisma';
import logger from '../../config/logger';
import { readSeedTemplate } from './TemplateRenderer';

/**
 * Seeds the `email_templates` rows from the on-disk .hbs templates and
 * keeps the schema-driven columns (`available_roles`, role labels,
 * locked recipients) in sync with the spec on every boot.
 *
 * Behavior:
 *   - First boot: inserts a row per spec and sets recipient_roles to the
 *     default subset of available_roles.
 *   - Subsequent boots: leaves admin-edited subject/body/cadence/etc.
 *     alone, but always overwrites `available_roles` (it's a system list,
 *     not a user setting) and never touches `recipient_roles` (those
 *     are user toggles).
 *   - New templates added in code are inserted on next boot.
 *
 * Locked templates: `auth.*` and `system.*`. These have copy that admins
 * can edit but cannot disable.
 */

export type RoleToken =
  | 'self'
  | 'agent'
  | 'direct_manager'
  | 'department_director'
  | 'creator'
  | 'original_qa'
  | 'qa_pool'
  | 'hr_witness'
  | 'assignee'
  | 'coach'
  | 'admins';

export interface SeedSpec {
  template_key: string;
  category: string;
  name: string;
  description: string;
  cadence: 'IMMEDIATE' | 'DAILY' | 'WEEKLY';
  is_locked: boolean;
  recipient_summary: string;
  allowed_variables: string[];
  /** Every role token surfaced as a checkbox in the admin editor. */
  available_roles: RoleToken[];
  /** Subset of available_roles that defaults to enabled. */
  default_recipient_roles: RoleToken[];
  /** Roles that cannot be unchecked in the editor (greyed/locked). */
  fixed_roles?: RoleToken[];
  /** Set to false to remove Daily/Weekly options from the editor. */
  digest_eligible?: boolean;
  /**
   * Human-readable description of where `{{deepLinkPath}}` resolves to in
   * this template's CTA. Surfaced in the admin editor next to the variable
   * chip so editors know what the button actually opens.
   */
  deep_link_target?: string;
}

/**
 * Friendly human label per role token. Surfaced in the admin editor and
 * in the auto-generated "you're receiving this because..." footer.
 */
export const ROLE_LABELS: Record<RoleToken, string> = {
  self: 'The user the event is about',
  agent: 'The agent (CSR)',
  direct_manager: "The agent's direct manager",
  department_director: "The agent's department director",
  creator: 'The user who initiated this',
  original_qa: 'The QA who originally graded the submission',
  qa_pool: "Department QA pool",
  hr_witness: 'The HR witness',
  assignee: 'The follow-up assignee',
  coach: 'The session coach',
  admins: 'All active admins',
};

const SEEDS: SeedSpec[] = [
  // ── Auth ────────────────────────────────────────────────────────────
  { template_key: 'auth.welcome', category: 'Auth', name: 'Welcome — set password',
    description: 'Sent when an admin creates a new user account.',
    cadence: 'IMMEDIATE', is_locked: true,
    recipient_summary: 'New user',
    allowed_variables: ['user', 'resetUrl', 'recipient', 'deepLinkPath'],
    available_roles: ['self'],
    default_recipient_roles: ['self'],
    fixed_roles: ['self'],
    digest_eligible: false,
    deep_link_target: 'Login page (/login). The CTA button uses {{resetUrl}} for the actual set-password link.' },

  { template_key: 'auth.password_reset', category: 'Auth', name: 'Password reset — link',
    description: 'Sent when a user requests a password reset.',
    cadence: 'IMMEDIATE', is_locked: true,
    recipient_summary: 'Requesting user',
    allowed_variables: ['user', 'resetUrl', 'requestedAt', 'requestIp', 'recipient', 'deepLinkPath'],
    available_roles: ['self'],
    default_recipient_roles: ['self'],
    fixed_roles: ['self'],
    digest_eligible: false,
    deep_link_target: 'Login page (/login). The CTA button uses {{resetUrl}} for the actual reset link.' },

  { template_key: 'auth.password_changed', category: 'Auth', name: 'Password changed — confirmation',
    description: 'Sent after a successful password change or reset.',
    cadence: 'IMMEDIATE', is_locked: true,
    recipient_summary: 'The user',
    allowed_variables: ['user', 'changedAt', 'recipient', 'deepLinkPath'],
    available_roles: ['self'],
    default_recipient_roles: ['self'],
    fixed_roles: ['self'],
    digest_eligible: false,
    deep_link_target: 'Login page (/login).' },

  { template_key: 'auth.account_locked', category: 'Auth', name: 'Account locked — user notice',
    description: 'Sent to the user whose account was just locked after repeated failed sign-ins.',
    cadence: 'IMMEDIATE', is_locked: true,
    recipient_summary: 'The locked user',
    allowed_variables: ['user', 'lockedAt', 'unlocksAt', 'recipient', 'deepLinkPath'],
    available_roles: ['self'],
    default_recipient_roles: ['self'],
    fixed_roles: ['self'],
    digest_eligible: false,
    deep_link_target: 'Forgot-password page (/forgot-password).' },

  { template_key: 'auth.account_locked_admin', category: 'Auth', name: 'Account locked — admin alert',
    description: 'Sent to admins when a user account was just locked.',
    cadence: 'IMMEDIATE', is_locked: true,
    recipient_summary: 'All active admins',
    allowed_variables: ['user', 'lockedAt', 'unlocksAt', 'failedAttempts', 'lastFailedIp', 'recipient', 'deepLinkPath'],
    available_roles: ['admins'],
    default_recipient_roles: ['admins'],
    digest_eligible: false,
    deep_link_target: 'Admin user management, where the locked user can be unlocked (/app/admin/users).' },

  // ── Submissions ────────────────────────────────────────────────────
  { template_key: 'submission.audit_finalized_by_qa', category: 'Submissions', name: 'QA review finalized',
    description: 'A human QA finalized an audit on a CSR submission.',
    cadence: 'IMMEDIATE', is_locked: false,
    recipient_summary: 'CSR + direct manager',
    allowed_variables: ['form', 'submission', 'csr', 'reviewer', 'passLabel', 'recipient', 'deepLinkPath'],
    available_roles: ['agent', 'direct_manager', 'department_director'],
    default_recipient_roles: ['agent', 'direct_manager'],
    digest_eligible: true,
    deep_link_target: 'Submission detail page (/app/quality/submissions/{id}).' },

  { template_key: 'submission.audit_finalized_by_ai', category: 'Submissions', name: 'AI review finalized',
    description: 'An AI-generated review was finalized. Defaults to a daily digest to prevent inbox flooding.',
    cadence: 'DAILY', is_locked: false,
    recipient_summary: 'CSR + direct manager (digested by default)',
    allowed_variables: ['form', 'submission', 'csr', 'reviewer', 'passLabel', 'recipient', 'deepLinkPath'],
    available_roles: ['agent', 'direct_manager', 'department_director'],
    default_recipient_roles: ['agent', 'direct_manager'],
    digest_eligible: true,
    deep_link_target: 'Submission detail page (/app/quality/submissions/{id}).' },

  { template_key: 'submission.critical_fail_by_qa', category: 'Submissions', name: 'Critical fail — QA-graded',
    description: 'A human QA finalized a submission with a critical fail.',
    cadence: 'IMMEDIATE', is_locked: false,
    recipient_summary: 'CSR + direct manager + director',
    allowed_variables: ['form', 'submission', 'csr', 'reviewer', 'reviewerKind', 'criticalFailQuestions', 'recipient', 'deepLinkPath'],
    available_roles: ['agent', 'direct_manager', 'department_director'],
    default_recipient_roles: ['agent', 'direct_manager', 'department_director'],
    digest_eligible: false,
    deep_link_target: 'Submission detail page (/app/quality/submissions/{id}).' },

  { template_key: 'submission.critical_fail_by_ai', category: 'Submissions', name: 'Critical fail — AI-graded',
    description: 'An AI-generated review surfaced a critical fail.',
    cadence: 'IMMEDIATE', is_locked: false,
    recipient_summary: 'CSR + direct manager + director',
    allowed_variables: ['form', 'submission', 'csr', 'reviewer', 'reviewerKind', 'criticalFailQuestions', 'recipient', 'deepLinkPath'],
    available_roles: ['agent', 'direct_manager', 'department_director'],
    default_recipient_roles: ['agent', 'direct_manager', 'department_director'],
    digest_eligible: false,
    deep_link_target: 'Submission detail page (/app/quality/submissions/{id}).' },

  // ── AI Routing ─────────────────────────────────────────────────────
  { template_key: 'ai.review_low_confidence', category: 'AI Routing', name: 'AI review — low confidence',
    description: 'AI confidence fell below the form threshold; routes to QA only (never CSR).',
    cadence: 'IMMEDIATE', is_locked: false,
    recipient_summary: 'Department QAs only',
    allowed_variables: ['form', 'submission', 'csr', 'recipient', 'deepLinkPath'],
    available_roles: ['qa_pool'],
    default_recipient_roles: ['qa_pool'],
    digest_eligible: true,
    deep_link_target: 'AI Reviewer inbox, draft for this submission (/app/quality/audit?promoteDraft={submissionId}).' },

  { template_key: 'ai.review_routed_to_qa', category: 'AI Routing', name: 'AI review — routed to QA',
    description: 'AI submission routed for human review (sampling, score-driven, or admin override).',
    cadence: 'IMMEDIATE', is_locked: false,
    recipient_summary: 'Department QAs only',
    allowed_variables: ['form', 'submission', 'csr', 'routingReason', 'routingReasonLabel', 'recipient', 'deepLinkPath'],
    available_roles: ['qa_pool'],
    default_recipient_roles: ['qa_pool'],
    digest_eligible: true,
    deep_link_target: 'AI Reviewer inbox, draft for this submission (/app/quality/audit?promoteDraft={submissionId}).' },

  // ── Disputes ───────────────────────────────────────────────────────
  { template_key: 'dispute.opened', category: 'Disputes', name: 'Dispute opened',
    description: 'A CSR opened a dispute on a finalized submission.',
    cadence: 'IMMEDIATE', is_locked: false,
    recipient_summary: 'Original QA + CSR\'s manager',
    allowed_variables: ['form', 'submission', 'csr', 'dispute', 'originalScore', 'recipient', 'deepLinkPath'],
    available_roles: ['original_qa', 'direct_manager'],
    default_recipient_roles: ['original_qa', 'direct_manager'],
    digest_eligible: false,
    deep_link_target: 'Dispute review page (/app/quality/disputes/{disputeId}).' },

  { template_key: 'dispute.resolved', category: 'Disputes', name: 'Dispute resolved',
    description: 'Sent to the disputant when their dispute is decided. The original QA can optionally be looped in for closure.',
    cadence: 'IMMEDIATE', is_locked: false,
    recipient_summary: 'Disputant (CSR), optionally the original QA',
    allowed_variables: ['form', 'submission', 'dispute', 'resolver', 'originalScore', 'disputeDenied', 'recipient', 'deepLinkPath'],
    available_roles: ['self', 'original_qa'],
    default_recipient_roles: ['self'],
    fixed_roles: ['self'],
    digest_eligible: false,
    deep_link_target: 'Submission detail page with dispute outcome (/app/quality/submissions/{id}).' },

  // ── Coaching ───────────────────────────────────────────────────────
  { template_key: 'coaching.scheduled', category: 'Coaching', name: 'Coaching scheduled',
    description: 'A coaching session has been scheduled.',
    cadence: 'IMMEDIATE', is_locked: false,
    recipient_summary: 'CSR',
    allowed_variables: ['session', 'csr', 'coach', 'recipient', 'deepLinkPath'],
    available_roles: ['agent'],
    default_recipient_roles: ['agent'],
    fixed_roles: ['agent'],
    digest_eligible: false,
    deep_link_target: 'Coaching session detail page (/app/training/coaching/{sessionId}).' },

  { template_key: 'coaching.awaiting_csr_action', category: 'Coaching', name: 'Coaching — action required',
    description: 'CSR action (acknowledgment / action plan) is required.',
    cadence: 'IMMEDIATE', is_locked: false,
    recipient_summary: 'CSR',
    allowed_variables: ['session', 'coach', 'recipient', 'deepLinkPath'],
    available_roles: ['agent'],
    default_recipient_roles: ['agent'],
    fixed_roles: ['agent'],
    digest_eligible: false,
    deep_link_target: 'Coaching session detail page where CSR can acknowledge (/app/training/coaching/{sessionId}).' },

  { template_key: 'coaching.quiz_pending', category: 'Coaching', name: 'Coaching — quiz pending',
    description: 'A required quiz on a coaching session is waiting on the CSR.',
    cadence: 'IMMEDIATE', is_locked: false,
    recipient_summary: 'CSR',
    allowed_variables: ['session', 'quiz', 'recipient', 'deepLinkPath'],
    available_roles: ['agent'],
    default_recipient_roles: ['agent'],
    fixed_roles: ['agent'],
    digest_eligible: false,
    deep_link_target: 'Coaching session detail where the CSR takes the quiz (/app/training/coaching/{sessionId}).' },

  { template_key: 'coaching.completed', category: 'Coaching', name: 'Coaching completed',
    description: 'A coaching session was marked complete.',
    cadence: 'IMMEDIATE', is_locked: false,
    recipient_summary: 'CSR + creator',
    allowed_variables: ['session', 'csr', 'coach', 'recipient', 'deepLinkPath'],
    available_roles: ['agent', 'creator'],
    default_recipient_roles: ['agent', 'creator'],
    digest_eligible: false,
    deep_link_target: 'Coaching session detail page (/app/training/coaching/{sessionId}).' },

  { template_key: 'coaching.canceled', category: 'Coaching', name: 'Coaching canceled',
    description: 'A coaching session was canceled.',
    cadence: 'IMMEDIATE', is_locked: false,
    recipient_summary: 'CSR',
    allowed_variables: ['session', 'recipient', 'deepLinkPath'],
    available_roles: ['agent'],
    default_recipient_roles: ['agent'],
    fixed_roles: ['agent'],
    digest_eligible: false,
    deep_link_target: 'Coaching session detail page (/app/training/coaching/{sessionId}).' },

  // ── Write-ups ──────────────────────────────────────────────────────
  { template_key: 'writeup.scheduled', category: 'Write-ups', name: 'Write-up — meeting scheduled',
    description: 'Disciplinary meeting scheduled.',
    cadence: 'IMMEDIATE', is_locked: false,
    recipient_summary: 'CSR + direct mgr + creator + HR witness',
    allowed_variables: ['writeup', 'csr', 'manager', 'hr_witness', 'employeeRightsReminder', 'recipient', 'deepLinkPath'],
    available_roles: ['agent', 'direct_manager', 'creator', 'hr_witness'],
    default_recipient_roles: ['agent', 'direct_manager', 'creator', 'hr_witness'],
    digest_eligible: false,
    deep_link_target: 'Write-up detail page (/app/performancewarnings/{writeupId}).' },

  { template_key: 'writeup.awaiting_signature', category: 'Write-ups', name: 'Write-up — awaiting signature',
    description: 'Write-up document is awaiting agent acknowledgment.',
    cadence: 'IMMEDIATE', is_locked: false,
    recipient_summary: 'CSR + direct mgr + creator + HR witness',
    allowed_variables: ['writeup', 'csr', 'manager', 'hr_witness', 'recipient', 'deepLinkPath'],
    available_roles: ['agent', 'direct_manager', 'creator', 'hr_witness'],
    default_recipient_roles: ['agent', 'direct_manager', 'creator', 'hr_witness'],
    digest_eligible: false,
    deep_link_target: 'Write-up document for signing (/app/performancewarnings/{writeupId}).' },

  { template_key: 'writeup.signed', category: 'Write-ups', name: 'Write-up — signed',
    description: 'Write-up document was signed.',
    cadence: 'IMMEDIATE', is_locked: false,
    recipient_summary: 'CSR + direct mgr + creator + HR witness',
    allowed_variables: ['writeup', 'csr', 'manager', 'hr_witness', 'recipient', 'deepLinkPath'],
    available_roles: ['agent', 'direct_manager', 'creator', 'hr_witness'],
    default_recipient_roles: ['agent', 'direct_manager', 'creator', 'hr_witness'],
    digest_eligible: false,
    deep_link_target: 'Write-up detail page (/app/performancewarnings/{writeupId}).' },

  { template_key: 'writeup.refused', category: 'Write-ups', name: 'Write-up — signature refused',
    description: 'Agent refused to sign the write-up.',
    cadence: 'IMMEDIATE', is_locked: false,
    recipient_summary: 'CSR + direct mgr + creator + HR witness',
    allowed_variables: ['writeup', 'csr', 'manager', 'hr_witness', 'witnessSlaDays', 'recipient', 'deepLinkPath'],
    available_roles: ['agent', 'direct_manager', 'creator', 'hr_witness'],
    default_recipient_roles: ['agent', 'direct_manager', 'creator', 'hr_witness'],
    digest_eligible: false,
    deep_link_target: 'Write-up detail page (/app/performancewarnings/{writeupId}).' },

  { template_key: 'writeup.followup_pending', category: 'Write-ups', name: 'Write-up — follow-up pending',
    description: 'A write-up follow-up is assigned.',
    cadence: 'IMMEDIATE', is_locked: false,
    recipient_summary: 'Follow-up assignee',
    allowed_variables: ['writeup', 'csr', 'recipient', 'deepLinkPath'],
    available_roles: ['assignee'],
    default_recipient_roles: ['assignee'],
    fixed_roles: ['assignee'],
    digest_eligible: false,
    deep_link_target: 'Write-up detail page (/app/performancewarnings/{writeupId}).' },

  // ── Digests ────────────────────────────────────────────────────────
  { template_key: 'digest.csr_daily', category: 'Digests', name: 'Daily CSR digest',
    description: 'Rolled-up summary of AI reviews on a CSR\'s work, delivered at 5pm ET.',
    cadence: 'IMMEDIATE', is_locked: false,
    recipient_summary: 'Each CSR (rollup)',
    allowed_variables: [
      'recipient', 'items', 'itemCount', 'hasMore', 'avgScore',
      'criticalFailCount', 'trendLabel', 'deepLinkPath',
    ],
    available_roles: ['agent'],
    default_recipient_roles: ['agent'],
    fixed_roles: ['agent'],
    digest_eligible: false,
    deep_link_target: 'CSR personal dashboard (/app/insights/dashboard).' },

  { template_key: 'digest.manager_weekly', category: 'Digests', name: 'Weekly manager digest',
    description: 'Team-wide AI review rollup, delivered Mondays at 8am ET.',
    cadence: 'IMMEDIATE', is_locked: false,
    recipient_summary: 'Each manager (team rollup)',
    allowed_variables: [
      'recipient', 'items', 'itemCount', 'hasMore', 'teamAvg',
      'deltaLabel', 'criticalFailCount', 'disputesOpenedCount',
      'topPerformers', 'needsAttention', 'deepLinkPath',
    ],
    available_roles: ['direct_manager'],
    default_recipient_roles: ['direct_manager'],
    fixed_roles: ['direct_manager'],
    digest_eligible: false,
    deep_link_target: 'Manager team dashboard (/app/insights/team).' },

  // ── System ─────────────────────────────────────────────────────────
  { template_key: 'system.circuit_tripped', category: 'System', name: 'Email circuit-breaker tripped',
    description: 'Sent to admins when the global email rate limit is exceeded.',
    cadence: 'IMMEDIATE', is_locked: true,
    recipient_summary: 'All admins',
    allowed_variables: [
      'threshold', 'count', 'trippedAt', 'resetsAt',
      'topTemplate', 'recipient', 'deepLinkPath',
    ],
    available_roles: ['admins'],
    default_recipient_roles: ['admins'],
    digest_eligible: false,
    deep_link_target: 'Admin email templates page (/app/admin/email-templates).' },
];

export async function seedEmailTemplates(): Promise<{ inserted: number; updated: number; skipped: number }> {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const spec of SEEDS) {
    const existing = await prisma.emailTemplate.findUnique({
      where: { template_key: spec.template_key },
    });

    if (existing) {
      // Always overwrite system-owned columns; preserve admin edits to
      // subject/body unless the template has never been edited (version=1).
      const fileSrc = readSeedTemplate(spec.template_key);
      const isUntouched = existing.version === 1;
      const copyChanged = !!fileSrc && (
        existing.subject !== fileSrc.subject.trim() ||
        existing.body_html !== fileSrc.body
      );
      const needsUpdate =
        JSON.stringify(existing.available_roles) !== JSON.stringify(spec.available_roles) ||
        existing.category !== spec.category ||
        existing.recipient_summary !== spec.recipient_summary ||
        existing.name !== spec.name ||
        existing.description !== spec.description ||
        JSON.stringify(existing.allowed_variables) !== JSON.stringify(spec.allowed_variables) ||
        !existing.recipient_roles ||
        (existing.recipient_roles as unknown as unknown[]).length === 0 ||
        (isUntouched && copyChanged);

      if (needsUpdate) {
        await prisma.emailTemplate.update({
          where: { id: existing.id },
          data: {
            category: spec.category,
            name: spec.name,
            description: spec.description,
            recipient_summary: spec.recipient_summary,
            allowed_variables: spec.allowed_variables as any,
            available_roles: spec.available_roles as any,
            recipient_roles:
              !existing.recipient_roles || (existing.recipient_roles as unknown as unknown[]).length === 0
                ? (spec.default_recipient_roles as any)
                : (existing.recipient_roles as any),
            ...(isUntouched && fileSrc
              ? { subject: fileSrc.subject.trim(), body_html: fileSrc.body }
              : {}),
          },
        });
        updated++;
      } else {
        skipped++;
      }
      continue;
    }

    const fileSrc = readSeedTemplate(spec.template_key);
    if (!fileSrc) {
      logger.warn('[templateSeeds] no filesystem template found, skipping', { key: spec.template_key });
      continue;
    }

    await prisma.emailTemplate.create({
      data: {
        template_key: spec.template_key,
        category: spec.category,
        name: spec.name,
        description: spec.description,
        subject: fileSrc.subject.trim(),
        body_html: fileSrc.body,
        body_text: null,
        cadence: spec.cadence,
        digest_filter: 'ALL',
        is_enabled: true,
        is_locked: spec.is_locked,
        allowed_variables: spec.allowed_variables as any,
        available_roles: spec.available_roles as any,
        recipient_roles: spec.default_recipient_roles as any,
        recipient_summary: spec.recipient_summary,
        version: 1,
      },
    });
    inserted++;
  }

  if (inserted > 0 || updated > 0) {
    logger.info('[templateSeeds] reconciled email_templates', { inserted, updated, skipped });
  }
  return { inserted, updated, skipped };
}

export const TEMPLATE_SEED_KEYS = SEEDS.map(s => s.template_key);
export const TEMPLATE_SEED_SPECS = SEEDS;

/** Look up a spec by template_key. Used by the admin controller / tests. */
export function getTemplateSpec(templateKey: string): SeedSpec | undefined {
  return SEEDS.find(s => s.template_key === templateKey);
}
