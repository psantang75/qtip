# QTIP Email Templates — Copy Review

> **Status:** all 26 templates are **live in the system** as of this
> writing. Categories, the new `recipient_roles` column, the editable
> Recipients toggles, the new Delivery radio UI, the new
> `auth.account_locked_admin` row, the new footer, and all derived
> variables (passLabel, routingReasonLabel, criticalFailQuestions,
> requestedAt, requestIp, originalScore, etc.) are all wired and
> running.
>
> This file is **only the email copy** so you can review what each
> recipient will actually see. Edit anything inline; when you hand the
> file back I'll do a single pass to push your edits into the
> filesystem `.hbs` templates and the DB rows.
>
> **Conventions in this doc**
> - `{{var}}` substitutions are shown as-is.
> - Where a body changes per recipient, the `agent`/`manager` blocks
>   are shown explicitly.
> - The shared header and footer wrap every email — only body copy is
>   shown here. The footer auto-appends:
>   *"You're receiving this because you're &lt;your role&gt; on this
>   &lt;submission/coaching session/etc.&gt;"*
> - Templates marked **Locked** can have their copy edited but cannot
>   be disabled by an admin.

---

## Table of contents

1.  [Auth (5 templates)](#1-auth)
2.  [Submissions (4 templates)](#2-submissions)
3.  [AI Routing (2 templates)](#3-ai-routing)
4.  [Disputes (2 templates)](#4-disputes)
5.  [Coaching (5 templates)](#5-coaching)
6.  [Write-ups (5 templates)](#6-write-ups)
7.  [Digests (2 templates)](#7-digests)
8.  [System (1 template)](#8-system)

---

## 1. Auth

### 1.1 `auth.welcome` — *Locked, Immediate*

**Recipients:** the new user (fixed)

**Subject**

> Your QTIP account is ready — set your password

**Body**

> # Welcome to QTIP
>
> Hi {{user.username}},
>
> Your manager has set up an account for you in **QTIP** (Quality
> Training Insights Platform). QTIP is where you'll see your reviews,
> coaching sessions, and training materials.
>
> To get started, set your password using the link below. **This link
> expires in 24 hours.**
>
> [ Set Your Password ]
>
> Your sign-in email is **{{user.email}}**.
>
> Once you sign in, the areas of QTIP available to you will depend on
> your role. If anything looks off, ask your manager.
>
> If you weren't expecting this email, please don't click the link —
> contact your administrator instead.

---

### 1.2 `auth.password_reset` — *Locked, Immediate*

**Recipients:** the requesting user (fixed)

**Subject**

> Reset your QTIP password

**Body**

> # Reset your password
>
> Hi {{user.username}},
>
> We received a request to reset your QTIP password. Click the button
> below to choose a new one. **This link expires in 30 minutes.**
>
> [ Reset Password ]
>
> Requested at {{formatDateTime requestedAt}} from IP **{{requestIp}}**.
>
> **Didn't request this?**
>
> Your password is unchanged. You can safely ignore this email. If you
> see repeated requests you didn't make, contact your administrator —
> someone may know your sign-in email.

---

### 1.3 `auth.password_changed` — *Locked, Immediate*

**Recipients:** the user (fixed)

**Subject**

> Your QTIP password was changed

**Body**

> # Your password was changed
>
> Hi {{user.username}},
>
> Your QTIP password was changed on {{formatDateTime changedAt}}.
>
> **If this was you**
> No further action is needed.
>
> **If this wasn't you**
> Contact your administrator immediately so they can lock your account
> and review recent activity.

---

### 1.4 `auth.account_locked` — *Locked, Immediate (user notice)*

**Recipients:** the locked user (fixed)

**Subject**

> Your QTIP account is temporarily locked

**Body**

> # Your account is temporarily locked
>
> Hi {{user.username}},
>
> Your QTIP account was locked at {{formatDateTime lockedAt}} after
> several failed sign-in attempts.
>
> **It will unlock automatically at {{formatDateTime unlocksAt}}.**
>
> If you need to sign in sooner, your administrator can unlock it for
> you.
>
> If you didn't try to sign in, notify your administrator — someone
> may know your sign-in email.

---

### 1.5 `auth.account_locked_admin` — *Locked, Immediate (admin alert)*

**Recipients:** all active admins (default)

**Subject**

> [QTIP] {{user.username}} account locked

**Body**

> # A user account has been locked
>
> A QTIP user account has been locked.
>
> | | |
> |---|---|
> | User | {{user.username}} |
> | Email | {{user.email}} |
> | Locked at | {{formatDateTime lockedAt}} |
> | Failed attempts | {{failedAttempts}} |
> | Last attempt IP | {{lastFailedIp}} |
> | Auto-unlocks at | {{formatDateTime unlocksAt}} |
>
> [ Unlock Account ]
>
> The user has been notified separately.

---

## 2. Submissions

### 2.1 `submission.audit_finalized_by_qa` — *Immediate (Daily/Weekly available)*

**Recipients (default):** agent, direct manager
**Available:** agent, direct manager, department director

**Subject**

> QA review complete: {{form.form_name}} — {{submission.total_score}}%

**Body — agent sees**

> # QA review complete
>
> Hi {{recipient.username}},
>
> {{reviewer.username}} finalized your **{{form.form_name}}** review.
>
> | | |
> |---|---|
> | Score | **{{submission.total_score}}%** — {{passLabel}} |
> | Reviewed | {{formatDateTime submission.submitted_at}} |
>
> [ View Submission ]
>
> If you believe the score is incorrect, you can open a dispute within
> the dispute window.

**Body — manager sees**

> Same fact table; opening line reads:
> "{{reviewer.username}} finalized a QA review for **{{csr.username}}**
> on **{{form.form_name}}**."

> *`passLabel` is auto-derived in the renderer from the form's pass
> threshold and the score: `passed` / `needs review` / `failed`.*

---

### 2.2 `submission.audit_finalized_by_ai` — *Daily digest by default*

**Recipients (default):** agent, direct manager
**Available:** agent, direct manager, department director

**Subject**

> AI review complete: {{form.form_name}} — {{submission.total_score}}%

**Body — agent sees**

> # AI review complete
>
> Hi {{recipient.username}},
>
> An AI-generated review of your **{{form.form_name}}** call has been
> finalized.
>
> | | |
> |---|---|
> | Score | **{{submission.total_score}}%** — {{passLabel}} |
> | AI confidence | {{submission.ai_overall_confidence}} |
> | Reviewed | {{formatDateTime submission.submitted_at}} |
>
> [ View Submission ]
>
> If the AI's confidence on this one is low, a QA reviewer will
> double-check it before it counts.

**Body — manager sees**

> Same fact table; opening line reads:
> "An AI-generated review for **{{csr.username}}** on
> **{{form.form_name}}** has been finalized."

---

### 2.3 `submission.critical_fail_by_qa` — *Immediate (Daily/Weekly disabled)*

**Recipients (default):** agent, direct manager, department director

**Subject**

> Critical fail — {{csr.username}} on {{form.form_name}}

**Body — agent sees**

> # Critical fail
>
> Hi {{recipient.username}},
>
> Your **{{form.form_name}}** review on
> {{formatDateTime submission.submitted_at}} has been finalized with a
> **critical fail**.
>
> | | |
> |---|---|
> | Score after cap | **{{submission.total_score}}%** |
> | Critical questions failed | **{{submission.critical_fail_count}}** |
> | Reviewer | {{reviewer.username}} |
>
> **Failed critical questions**
> - *(auto-loaded list of failed critical questions)*
>
> [ Review Submission ]
>
> Your manager will follow up with coaching. If you believe the score
> is wrong, you can open a dispute from the submission page.

**Body — manager / director sees**

> Same fact table + failed-question list; opening line reads:
> "A QA review for **{{csr.username}}** on **{{form.form_name}}**
> finalized with a **critical fail**."

---

### 2.4 `submission.critical_fail_by_ai` — *Immediate (Daily/Weekly disabled)*

**Recipients (default):** agent, direct manager, department director

**Subject**

> [AI] Critical fail — {{csr.username}} on {{form.form_name}}

**Body — agent sees**

> # AI flagged a critical fail
>
> Hi {{recipient.username}},
>
> An **AI-generated** review of your **{{form.form_name}}** call
> surfaced a critical fail.
>
> | | |
> |---|---|
> | Score after cap | **{{submission.total_score}}%** |
> | Critical questions failed | **{{submission.critical_fail_count}}** |
> | AI confidence | {{submission.ai_overall_confidence}} |
>
> **Failed critical questions**
> - *(auto-loaded list)*
>
> [ Review Submission ]
>
> A QA reviewer will double-check this AI result before any coaching
> is assigned. You'll receive a follow-up email once it's been
> confirmed.

**Body — manager / director sees**

> Closes with: "Per policy, this AI result is also being routed to QA
> for a human double-check before any coaching is initiated."

---

## 3. AI Routing

### 3.1 `ai.review_routed_to_qa` — *Immediate (Daily available)*

**Recipients (default):** department QA pool

**Subject**

> QA needed: AI review of {{csr.username}} on {{form.form_name}}

**Body**

> # AI review needs your sign-off
>
> Hi {{recipient.username}},
>
> An AI-finalized review needs your sign-off because **{{routingReasonLabel}}**.
>
> | | |
> |---|---|
> | Form | **{{form.form_name}}** |
> | Agent | {{csr.username}} |
> | AI score | {{submission.total_score}}% |
> | Routed | {{formatDateTime submission.submitted_at}} |
>
> [ Open in QA Inbox ]
>
> *Tip: open the QA Inbox to see all AI reviews waiting on you.*

> *`routingReasonLabel` is mapped from the enum:* `low_confidence` →
> "AI confidence was below the form threshold", etc.

---

### 3.2 `ai.review_low_confidence` — *Immediate*

**Recipients (default):** department QA pool *(deliberately not the agent)*

**Subject**

> Low-confidence AI review — {{csr.username}} on {{form.form_name}}

**Body**

> # Low-confidence AI review needs human eyes
>
> Hi {{recipient.username}},
>
> An AI-generated review came in below the form's confidence threshold
> and needs human eyes.
>
> | | |
> |---|---|
> | Form | **{{form.form_name}}** |
> | Agent | {{csr.username}} |
> | AI confidence | **{{submission.ai_overall_confidence}}** |
> | Threshold | {{form.ai_sample_low_confidence_threshold}} |
> | AI score | {{submission.total_score}}% |
>
> [ Open in QA Inbox ]
>
> Please re-grade. The agent has not been notified about this review
> yet — they'll see the result once it's finalized.

---

## 4. Disputes

### 4.1 `dispute.opened` — *Immediate*

**Recipients (default):** the original QA + the agent's direct manager

**Subject**

> Dispute opened — {{csr.username}} on {{form.form_name}}

**Body**

> # Dispute opened
>
> Hi {{recipient.username}},
>
> **{{csr.username}}** has opened a dispute on a finalized submission.
>
> | | |
> |---|---|
> | Form | **{{form.form_name}}** |
> | Submission | #{{submission.id}} |
> | Original score | {{originalScore}}% |
> | Opened | {{formatDateTime dispute.created_at}} |
>
> **Reason from {{csr.username}}**
> > {{dispute.reason}}
>
> [ Review Dispute ]
>
> Please review and resolve this dispute as soon as possible. The
> agent is waiting on the outcome.

---

### 4.2 `dispute.resolved` — *Immediate*

**Recipients (default):** the disputant CSR (fixed)

**Subject — when upheld**

> Dispute upheld — {{form.form_name}} score updated to {{submission.total_score}}%

**Subject — when denied**

> Dispute decision: original score stands ({{submission.total_score}}%)

**Body**

> # Your dispute has been resolved
>
> Hi {{recipient.username}},
>
> Your dispute on submission **#{{submission.id}}** has been
> **{{dispute.status}}** by {{resolver.username}} on
> {{formatDateTime dispute.resolved_at}}.
>
> | | |
> |---|---|
> | Form | **{{form.form_name}}** |
> | Score change | {{originalScore}}% → **{{submission.total_score}}%** |
>
> **Resolution notes**
> > {{dispute.resolution_notes}}
>
> [ View Submission ]
>
> *(when denied:)* If you disagree with this resolution, please discuss
> directly with your manager.

---

## 5. Coaching

### 5.1 `coaching.scheduled` — *Immediate*

**Recipients:** the agent (fixed)

**Subject**

> {{session.coaching_purpose}} coaching with {{coach.username}} —
> {{formatDateTime session.session_date}}

**Body**

> # Coaching session scheduled
>
> Hi {{recipient.username}},
>
> A coaching session has been scheduled for you.
>
> | | |
> |---|---|
> | When | **{{formatDateTime session.session_date}}** |
> | Duration | {{session.duration_minutes}} minutes |
> | Format | {{session.coaching_format}} |
> | Where | {{session.location}} |
> | Coach | {{coach.username}} |
> | Purpose | {{session.coaching_purpose}} |
>
> [ View Session ]
>
> *(if preparation_notes set:)* **To prepare:** {{session.preparation_notes}}

---

### 5.2 `coaching.awaiting_csr_action` — *Immediate*

**Recipients:** the agent (fixed)

**Subject**

> Action required on your coaching session — by {{formatDate session.action_due_date}}

**Body**

> # Coaching session needs your acknowledgment
>
> Hi {{recipient.username}},
>
> Your **{{session.coaching_purpose}}** coaching session with
> {{coach.username}} on {{formatDate session.session_date}} needs your
> acknowledgment{{#if require_action_plan}} and an action plan{{/if}}.
>
> **Please respond by {{formatDate session.action_due_date}}.**
>
> [ Open Session ]

---

### 5.3 `coaching.quiz_pending` — *Immediate*

**Recipients:** the agent (fixed)

**Subject**

> Quiz pending: {{quiz.title}} — {{quiz.question_count}} questions

**Body**

> # A quiz is waiting for you
>
> Hi {{recipient.username}},
>
> A required quiz is waiting for you on your
> **{{session.coaching_purpose}}** coaching session.
>
> | | |
> |---|---|
> | Quiz | **{{quiz.title}}** |
> | Questions | {{quiz.question_count}} |
> | Estimated time | {{quiz.estimated_minutes}} min |
> | Due | {{formatDate quiz.due_date}} |
>
> [ Take Quiz ]

---

### 5.4 `coaching.completed` — *Immediate*

**Recipients (default):** agent + creator

**Subject**

> {{session.coaching_purpose}} coaching with {{coach.username}} marked complete

**Body — agent sees**

> # Coaching session complete
>
> Hi {{recipient.username}},
>
> Your **{{session.coaching_purpose}}** coaching session with
> {{coach.username}} on {{formatDate session.session_date}} is
> complete.
>
> *(if outcome_summary set:)*
> **Outcome notes**
> > {{session.outcome_summary}}
>
> [ View Session ]

**Body — creator sees**

> "The **{{session.coaching_purpose}}** coaching session you scheduled
> for {{csr.username}} on {{formatDate session.session_date}} has been
> marked complete by {{coach.username}}."

---

### 5.5 `coaching.canceled` — *Immediate*

**Recipients:** the agent (fixed)

**Subject**

> Coaching session for {{formatDate session.session_date}} was canceled

**Body**

> # Coaching session canceled
>
> Hi {{recipient.username}},
>
> Your coaching session originally scheduled for
> {{formatDateTime session.session_date}} has been canceled.
>
> *(if cancel_reason set:)*
> **Reason**
> {{session.cancel_reason}}
>
> [ View Coaching ]
>
> Your manager or coach will be in touch to reschedule if needed.

---

## 6. Write-ups

> **HR / legal review recommended on the wording in this section.**
> The current copy is honest and minimal — refine the
> `employeeRightsReminder` line and the witness-SLA line as
> appropriate.

### 6.1 `writeup.scheduled` — *Immediate (Daily/Weekly disabled)*

**Recipients (default):** agent, direct manager, creator, HR witness

**Subject — agent**

> Meeting scheduled: {{writeup.document_type}} on {{formatDate writeup.meeting_date}}

**Subject — manager / creator / HR**

> [HR] {{writeup.document_type}} meeting for {{csr.username}} —
> {{formatDate writeup.meeting_date}}

**Body — agent sees**

> # {{writeup.document_type}} meeting scheduled
>
> Hi {{recipient.username}},
>
> A meeting has been scheduled with your manager to discuss a
> **{{writeup.document_type}}**.
>
> | | |
> |---|---|
> | When | **{{formatDateTime writeup.meeting_date}}** |
> | Duration | {{writeup.duration_minutes}} minutes |
> | Where | {{writeup.location}} |
> | Manager | {{manager.username}} |
> | HR witness | {{hr_witness.username}} |
>
> [ View Write-up ]
>
> *What to expect:* the meeting will cover the points described in the
> document linked above. You may bring written notes.
> {{employeeRightsReminder}}

**Body — manager / creator / HR sees**

> Same fact table (with `Agent` row added); no "what to expect"
> footer.

---

### 6.2 `writeup.awaiting_signature` — *Immediate*

**Recipients (default):** agent, direct manager, creator, HR witness

**Subject — agent**

> Signature required: {{writeup.document_type}} by {{formatDate writeup.signature_due_date}}

**Subject — manager / creator / HR**

> [HR] {{csr.username}} — {{writeup.document_type}} awaiting signature

**Body — agent sees**

> # {{writeup.document_type}} awaiting signature
>
> Hi {{recipient.username}},
>
> A **{{writeup.document_type}}** document is ready for your review
> and acknowledgment.
>
> **Please review and acknowledge by
> {{formatDate writeup.signature_due_date}}.**
>
> [ Open Document ]
>
> Signing acknowledges receipt of this document, **not agreement**
> with its contents. You may add written comments before signing.

**Body — manager / creator / HR sees**

> "{{csr.username}} has a **{{writeup.document_type}}** awaiting their
> signature, due {{formatDate writeup.signature_due_date}}."
> "The agent has been notified and will be reminded automatically.
> Escalate if there is no response by the due date."

---

### 6.3 `writeup.signed` — *Immediate*

**Recipients (default):** agent, direct manager, creator, HR witness

**Subject**

> {{writeup.document_type}} signed — {{csr.username}}

**Body — agent sees**

> "You signed the **{{writeup.document_type}}** on
> {{formatDateTime writeup.signed_at}}. A copy has been retained in
> your employee record."
> [ View Write-up ]

**Body — manager / creator / HR sees**

> "{{csr.username}} signed the **{{writeup.document_type}}** on
> {{formatDateTime writeup.signed_at}}. A copy has been retained for
> HR records."
> [ View Write-up ]

---

### 6.4 `writeup.refused` — *Immediate*

**Recipients (default):** agent, direct manager, creator, HR witness

**Subject**

> SIGNATURE REFUSED — {{writeup.document_type}} for {{csr.username}}

**Body — agent sees**

> # Signature refused
>
> "You declined to sign the **{{writeup.document_type}}** on
> {{formatDateTime writeup.refused_at}}."
>
> *(if refusal_reason set:)* **Reason on file** > {{writeup.refusal_reason}}
>
> [ Open Write-up ]
>
> "Per policy, this document is filed in your employee record
> regardless of signature. If you'd like to add written comments, you
> can do so from the link above."

**Body — manager / creator / HR sees**

> "{{csr.username}} refused to sign the **{{writeup.document_type}}**
> on {{formatDateTime writeup.refused_at}}."
>
> *(if refusal_reason set:)* **Reason from agent** > {{writeup.refusal_reason}}
>
> **Next steps**
> "Per policy, document the witness's observation in the employee
> record within {{witnessSlaDays}} business days. The document will be
> filed regardless of signature."

> *`witnessSlaDays` defaults to **3** in the template; tell me to make
> it editable elsewhere if HR/legal wants a different number.*

---

### 6.5 `writeup.followup_pending` — *Immediate*

**Recipients:** the assignee (fixed)

**Subject**

> Follow-up due {{formatDate writeup.follow_up_date}}: {{writeup.followup_type}} with {{csr.username}}

**Body**

> # Write-up follow-up assigned to you
>
> Hi {{recipient.username}},
>
> A **{{writeup.followup_type}}** has been assigned to you for
> {{csr.username}}'s **{{writeup.document_type}}**, due
> **{{formatDate writeup.follow_up_date}}**.
>
> [ Open Follow-up ]
>
> When you've completed the follow-up, mark it complete from the link
> above so it's recorded in the employee file.

---

## 7. Digests

### 7.1 `digest.csr_daily` — *Daily summary at 5pm ET*

**Recipients:** the agent (fixed)

**Subject**

> QTIP daily summary — {{itemCount}} reviews, avg {{avgScore}}%

**Body**

> # Today's AI reviews on your work
>
> Hi {{recipient.username}},
>
> | | |
> |---|---|
> | Reviews | **{{itemCount}}** |
> | Average | {{avgScore}}% |
> | Critical fails | **{{criticalFailCount}}** |
> | vs your 30-day avg | {{trendLabel}} |
>
> | Form | Score | Status |
> |---|---|---|
> | Phone QA | 92% | passed |
> | Ticket QA | 78% | needs review |
> | Email QA | 88% | passed |
>
> *(table rendered from the `items` array.)*
>
> [ View All in QTIP ]

> *Note:* `avgScore`, `criticalFailCount`, `trendLabel` are placeholders
> that the digest scheduler will compute when it lands. The template is
> already built to render them.

---

### 7.2 `digest.manager_weekly` — *Weekly summary Monday 8am ET*

**Recipients:** the direct manager (fixed)

**Subject**

> Weekly QC — team avg {{teamAvg}}% ({{deltaLabel}}), {{itemCount}} reviews

**Body**

> # Your team's AI reviews this week
>
> Hi {{recipient.username}},
>
> | | |
> |---|---|
> | Team average | **{{teamAvg}}%** ({{deltaLabel}} vs prior week) |
> | Reviews | {{itemCount}} |
> | Critical fails | **{{criticalFailCount}}** |
> | Disputes opened | {{disputesOpenedCount}} |
>
> **Top performers**
> - {{csrName}} — {{avg}}% ({{reviews}} reviews)
> - …
>
> **Needs attention**
> - {{csrName}} — {{avg}}% ({{reviews}} reviews, {{criticalFails}} critical)
> - …
>
> [ Open Team Dashboard ]

---

## 8. System

### 8.1 `system.circuit_tripped` — *Locked, Immediate*

**Recipients:** all active admins (default)

**Subject**

> [QTIP] Email circuit-breaker tripped

**Body**

> # Email circuit-breaker tripped
>
> The QTIP email circuit-breaker has tripped.
>
> QTIP sent more than {{threshold}} emails in a 5-minute window. To
> protect users from a notification flood, **non-critical templates
> have been paused.** Critical templates (auth, system) continue to
> send.
>
> | | |
> |---|---|
> | Sends in window | **{{count}}** |
> | Top template | `{{topTemplate.key}}` ({{topTemplate.count}} sends) |
> | Tripped at | {{formatDateTime trippedAt}} |
> | Auto-resets at | {{formatDateTime resetsAt}} |
>
> [ Review Templates ]
>
> Investigate the top template above for an unintended loop or trigger
> spike. Once the cause is fixed, the breaker will auto-reset; or you
> can manually clear it from the Email Templates → System Health tab.

---

## How to give feedback

Two easy options:

1. **Edit this file inline** and hand it back. I'll do a single pass
   across the `.hbs` files and DB rows. Strikethroughs, full
   rewrites, "swap this with that" — whatever's easiest. Just leave
   the section headings (e.g. `### 2.1 ...`) intact so I can match
   each template.
2. **Edit live in the UI.** Each template's copy can be edited at
   `/app/admin/email-templates`; "Reset to default" reverts to the
   filesystem version. Recipients are toggled in the new
   **Recipients** card; cadence is selected via the new **Delivery**
   radio buttons.
