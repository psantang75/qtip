# QTIP Email Templates — Review Copy

This doc contains the **subject** and **body** for every email template in
QTIP, written for review. The HTML wrapper, header, footer, and CTA-button
markup are added by the system at render time — only the wording shown
below changes per template.

**How to use this doc**

- Read each template in plain English. `{{variable}}` placeholders are
  filled at send time.
- Edit anything you want changed. Tell me which templates to apply and
  I'll push the wording back into the `.hbs` files and DB.
- Conditional copy is shown as `[ROLE: agent]` / `[ROLE: manager / others]`
  blocks where the email reads differently for the agent vs. their manager.

**Industry-standard conventions used throughout**

- One clear primary CTA per email (button label is shown in **bold**).
- Subjects are short, action-first, include one identifier when useful
  (name, score, form, date). No all-caps except true escalations
  (refusal, system breach).
- Security/auth emails always carry a "if this wasn't you" paragraph and
  state the link expiry.
- AI-generated reviews mention AI explicitly and make the QA safety net
  visible to the agent.
- Manager copy is informational ("here's what your team did") and never
  duplicates an action the agent has already been asked to take.

---

## Auth

### `auth.welcome` — Welcome — set password

**Subject:** Your QTIP Account Is Ready — Set Your Password

**Body:**

> **Welcome to QTIP**
>
> Hi {{user.username}},
>
> Your manager has set up an account for you in **QTIP** (Quality
> Training Insights Platform). QTIP is where you'll see your reviews,
> coaching sessions, and performance metrics.
>
> To get started, set your password using the button below. **This link
> expires in 24 hours.**
>
> **[Set Your Password]**
>
> Your sign-in email is **{{user.email}}**. Once you sign in, the areas
> of QTIP available to you depend on your role — if anything looks off,
> ask your manager.
>
> *If you weren't expecting this email, please don't click the link —
> contact your administrator instead.*

---

### `auth.password_reset` — Password reset — link

**Subject:** Reset Your QTIP Password

**Body:**

> **Reset your password**
>
> Hi {{user.username}},
>
> We received a request to reset your QTIP password. Click the button
> below to choose a new one. **This link expires in 30 minutes.**
>
> **[Reset Password]**
>
> Requested at {{requestedAt}}{{#if requestIp}} from IP **{{requestIp}}**{{/if}}.
>
> **Didn't request this?** Your password is unchanged — you can safely
> ignore this email. If you see repeated requests you didn't make,
> contact your administrator; someone may know your sign-in email.

---

### `auth.password_changed` — Password changed — confirmation

**Subject:** Your QTIP Password Was Changed

**Body:**

> **Your password was changed**
>
> Hi {{user.username}},
>
> Your QTIP password was changed on {{changedAt}}.
>
> **If this was you** — no further action is needed.
>
> **If this wasn't you** — contact your administrator immediately so
> they can lock your account and review recent activity.

---

### `auth.account_locked` — Account locked — user notice

**Subject:** Your QTIP Account Is Temporarily Locked

**Body:**

> **Your account is temporarily locked**
>
> Hi {{user.username}},
>
> Your QTIP account was locked at {{lockedAt}} after several failed
> sign-in attempts.
>
> {{#if unlocksAt}}**It will unlock automatically at {{unlocksAt}}.**{{/if}}
>
> If you need to sign in sooner, your administrator can unlock it for you.
>
> *If you didn't try to sign in, notify your administrator — someone may
> know your sign-in email.*

---

### `auth.account_locked_admin` — Account locked — admin alert

**Subject:** [QTIP] {{user.username}} Account Locked

**Body:**

> **A user account has been locked**
>
> A QTIP user account has been locked.
>
> | | |
> |---|---|
> | User | **{{user.username}}** |
> | Email | {{user.email}} |
> | Locked at | {{lockedAt}} |
> | Failed attempts | **{{failedAttempts}}** |
> | Last attempt IP | {{lastFailedIp}} |
> | Auto-unlocks at | {{unlocksAt}} |
>
> **[Unlock Account]**
>
> The user has been notified separately.

---

## Submissions

### `submission.audit_finalized_by_qa` — QA review finalized

**Subject:** QA Review Complete: {{form.form_name}} — {{submission.total_score}}%

**Body:**

> **QA review complete**
>
> Hi {{recipient.username}},
>
> [ROLE: agent]
> {{reviewer.username}} finalized your **{{form.form_name}}** review.
>
> [ROLE: manager / director]
> {{reviewer.username}} finalized a QA review for **{{csr.username}}**
> on **{{form.form_name}}**.
>
> | | |
> |---|---|
> | Score | **{{submission.total_score}}%** — {{passLabel}} |
> | Reviewed | {{submission.submitted_at}} |
>
> **[View Submission]**
>
> [ROLE: agent]
> *If you believe the score is incorrect, you can open a dispute within
> the dispute window. Open the submission to see comments and any
> flagged items.*

---

### `submission.audit_finalized_by_ai` — AI review finalized

**Subject:** AI Review Complete: {{form.form_name}} — {{submission.total_score}}%

**Body:**

> **AI review complete**
>
> Hi {{recipient.username}},
>
> [ROLE: agent]
> An AI-generated review of your **{{form.form_name}}** has been
> finalized.
>
> [ROLE: manager / director]
> An AI-generated review for **{{csr.username}}** on **{{form.form_name}}**
> has been finalized.
>
> | | |
> |---|---|
> | Score | **{{submission.total_score}}%** — {{passLabel}} |
> | AI confidence | {{submission.ai_overall_confidence}} |
> | Reviewed | {{submission.submitted_at}} |
>
> **[View Submission]**
>
> [ROLE: agent]
> *If the AI's confidence on this one is low, a QA reviewer will
> double-check it before it counts.*

---

### `submission.critical_fail_by_qa` — Critical fail — QA-graded

**Subject:** Critical Fail — {{csr.username}} on {{form.form_name}}

**Body:**

> **Critical fail**
>
> Hi {{recipient.username}},
>
> [ROLE: agent]
> Your **{{form.form_name}}** review on {{submission.submitted_at}}
> has been finalized with a **critical fail**.
>
> [ROLE: manager / director]
> A QA review for **{{csr.username}}** on **{{form.form_name}}**
> finalized with a **critical fail**.
>
> | | |
> |---|---|
> | Score after cap | **{{submission.total_score}}%** |
> | Critical questions failed | **{{submission.critical_fail_count}}** |
> | Reviewer | {{reviewer.username}} |
> | Reviewed | {{submission.submitted_at}} |
>
> {{#if criticalFailQuestions.length}}
> **Failed critical items**
> - {{this.text}}   *(per question)*
> {{/if}}
>
> **[Review Submission]**
>
> [ROLE: agent]
> *Critical questions cap the score regardless of how the rest of the
> form went. Talk through this one with your manager — and if you
> believe it's incorrect, open a dispute from the submission page.*
>
> [ROLE: manager / director]
> *Plan a coaching session to walk through the failed items. Document
> any corrective action in the agent's record.*

---

### `submission.critical_fail_by_ai` — Critical fail — AI-graded

**Subject:** Critical Fail (AI) — {{csr.username}} on {{form.form_name}}

**Body:**

> **Critical fail (AI-graded)**
>
> Hi {{recipient.username}},
>
> [ROLE: agent]
> An AI-generated review of your **{{form.form_name}}** has been
> finalized with a **critical fail**.
>
> [ROLE: manager / director]
> An AI review for **{{csr.username}}** on **{{form.form_name}}**
> finalized with a **critical fail**.
>
> | | |
> |---|---|
> | Score after cap | **{{submission.total_score}}%** |
> | Critical questions failed | **{{submission.critical_fail_count}}** |
> | AI confidence | {{submission.ai_overall_confidence}} |
> | Reviewed | {{submission.submitted_at}} |
>
> {{#if criticalFailQuestions.length}}
> **Failed critical items**
> - {{this.text}}   *(per question)*
> {{/if}}
>
> **[Review Submission]**
>
> [ROLE: agent]
> *Because this was a critical fail, a QA reviewer will sign off on it
> before any disciplinary action is taken. If you'd like to add context,
> open a dispute from the submission page.*
>
> [ROLE: manager / director]
> *AI critical fails are routed for QA confirmation by default. Hold off
> on disciplinary action until QA signs off.*

---

## AI Routing

### `ai.review_low_confidence` — AI review — low confidence

**Subject:** Low-Confidence AI Review Needs Your Eyes — {{csr.username}}

**Body:**

> **AI review needs human sign-off**
>
> Hi {{recipient.username}},
>
> An AI-generated review for **{{csr.username}}** on **{{form.form_name}}**
> came in below this form's confidence threshold and is sitting in your
> QA inbox as a draft.
>
> | | |
> |---|---|
> | Form | {{form.form_name}} |
> | Submission | #{{submission.id}} |
> | AI confidence | {{submission.ai_overall_confidence}} |
>
> **[Open in QA Inbox]**
>
> *The agent has not been notified. Take a look, adjust if needed, and
> promote the draft when you're satisfied.*

---

### `ai.review_routed_to_qa` — AI review — routed to QA

**Subject:** AI Review Routed to QA — {{csr.username}}

**Body:**

> **AI review routed for human review**
>
> Hi {{recipient.username}},
>
> An AI review for **{{csr.username}}** on **{{form.form_name}}** has
> been routed to QA — {{routingReasonLabel}}.
>
> | | |
> |---|---|
> | Form | {{form.form_name}} |
> | Submission | #{{submission.id}} |
> | Routing reason | {{routingReasonLabel}} |
>
> **[Open in QA Inbox]**
>
> *The agent has not been notified. Promote the draft when you're done.*

---

## Disputes

### `dispute.opened` — Dispute opened

**Subject:** Dispute Opened — {{csr.username}} on {{form.form_name}}

**Body:**

> **Dispute opened**
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
> | Opened | {{dispute.created_at}} |
>
> {{#if dispute.reason}}
> **Reason from {{csr.username}}**
> > {{dispute.reason}}
> {{/if}}
>
> **[Review Dispute]**
>
> *Please review and resolve as soon as possible — the agent is waiting
> on the outcome.*

---

### `dispute.resolved` — Dispute resolved

**Subject:** Dispute Resolved — {{form.form_name}} ({{#if disputeDenied}}Upheld{{else}}Adjusted{{/if}})

**Body:**

> **Dispute resolved**
>
> Hi {{recipient.username}},
>
> {{resolver.username}} has resolved your dispute on **{{form.form_name}}**.
>
> | | |
> |---|---|
> | Original score | {{originalScore}}% |
> | Final score | **{{submission.total_score}}%** |
> | Outcome | {{#if disputeDenied}}Original score upheld{{else}}Score adjusted{{/if}} |
> | Resolved | {{dispute.resolved_at}} |
>
> {{#if dispute.resolution_notes}}
> **Resolution notes**
> > {{dispute.resolution_notes}}
> {{/if}}
>
> **[View Submission]**
>
> *This decision is final. If you have questions, follow up with your
> manager or QA directly.*

---

## Coaching

### `coaching.scheduled` — Coaching scheduled

**Subject:** Coaching Scheduled — {{session.topic}} on {{formatDate session.scheduled_at}}

**Body:**

> **Coaching session scheduled**
>
> Hi {{recipient.username}},
>
> {{coach.username}} has scheduled a coaching session with you.
>
> | | |
> |---|---|
> | Topic | **{{session.topic}}** |
> | When | {{formatDateTime session.scheduled_at}} |
> | Coach | {{coach.username}} |
>
> **[View Session]**
>
> *Please be on time and ready to discuss the topic above. If you need
> to reschedule, reach out to {{coach.username}} directly.*

---

### `coaching.awaiting_csr_action` — Coaching — action required

**Subject:** Action Needed: Acknowledge Your Coaching on {{session.topic}}

**Body:**

> **Action required on your coaching session**
>
> Hi {{recipient.username}},
>
> Your coaching session on **{{session.topic}}** with
> {{coach.username}} is waiting on you to acknowledge it and (if
> applicable) submit your action plan.
>
> **[Open Session]**
>
> *Sessions stay open until you acknowledge them. The sooner this is
> wrapped up, the cleaner your record looks.*

---

### `coaching.quiz_pending` — Coaching — quiz pending

**Subject:** Quiz Pending — {{session.topic}}

**Body:**

> **Quiz pending on your coaching session**
>
> Hi {{recipient.username}},
>
> Your coaching session on **{{session.topic}}** has a follow-up quiz
> waiting for you{{#if quiz.due_at}}, due **{{formatDate quiz.due_at}}**{{/if}}.
>
> **[Take Quiz]**
>
> *The session won't be marked complete until the quiz is submitted.*

---

### `coaching.completed` — Coaching completed

**Subject:** Coaching Completed — {{session.topic}}

**Body:**

> **Coaching session completed**
>
> Hi {{recipient.username}},
>
> [ROLE: agent]
> Your coaching session on **{{session.topic}}** with {{coach.username}}
> is now complete.
>
> [ROLE: creator]
> A coaching session you initiated for {{csr.username}} on
> **{{session.topic}}** has been marked complete by {{coach.username}}.
>
> **[View Session]**
>
> *Notes, action items, and any quiz results are available on the
> session page for your records.*

---

### `coaching.canceled` — Coaching canceled

**Subject:** Coaching Canceled — {{session.topic}}

**Body:**

> **Coaching session canceled**
>
> Hi {{recipient.username}},
>
> Your coaching session on **{{session.topic}}** has been canceled.
>
> **[View Coaching]**
>
> *If a replacement is needed, your manager or coach will reach out.*

---

## Write-ups

### `writeup.scheduled` — Write-up — meeting scheduled

**Subject:** {{writeup.document_type}} Meeting — {{formatDateTime writeup.meeting_at}}

**Body:**

> **{{writeup.document_type}} meeting scheduled**
>
> Hi {{recipient.username}},
>
> [ROLE: agent]
> A meeting has been scheduled with you regarding a
> **{{writeup.document_type}}**.
>
> [ROLE: manager / creator / HR witness]
> A **{{writeup.document_type}}** meeting has been scheduled with
> {{csr.username}}.
>
> | | |
> |---|---|
> | When | **{{formatDateTime writeup.meeting_at}}** |
> | Manager | {{manager.username}} |
> | HR witness | {{hr_witness.username}} |
>
> **[View Write-up]**
>
> [ROLE: agent]
> {{#if employeeRightsReminder}}*{{employeeRightsReminder}}*{{else}}*You
> may bring a written response or notes. The meeting will be
> documented.*{{/if}}
>
> [ROLE: manager / creator / HR witness]
> *Please review the document beforehand and arrive on time. The
> witness's role is to observe and confirm the meeting took place
> as documented.*

---

### `writeup.awaiting_signature` — Write-up — awaiting signature

**Subject:** Signature Required — {{writeup.document_type}}

**Body:**

> **{{writeup.document_type}} awaiting signature**
>
> Hi {{recipient.username}},
>
> [ROLE: agent]
> The **{{writeup.document_type}}** discussed in your meeting is ready
> for your acknowledgment.
>
> [ROLE: manager / creator / HR witness]
> {{csr.username}}'s **{{writeup.document_type}}** is awaiting
> signature.
>
> **[Open Document]**
>
> [ROLE: agent]
> *Signing acknowledges that you've read the document — it does not
> mean you agree with everything in it. You can add written comments
> from the same page.*
>
> [ROLE: manager / creator / HR witness]
> *The agent has been asked to sign. They will be reminded
> automatically until the document is acknowledged or refused.*

---

### `writeup.signed` — Write-up — signed

**Subject:** {{writeup.document_type}} Signed — {{csr.username}}

**Body:**

> **{{writeup.document_type}} signed**
>
> Hi {{recipient.username}},
>
> [ROLE: agent]
> You signed the **{{writeup.document_type}}** on
> {{formatDateTime writeup.signed_at}}. A copy has been retained in
> your employee record.
>
> [ROLE: manager / creator / HR witness]
> {{csr.username}} signed the **{{writeup.document_type}}** on
> {{formatDateTime writeup.signed_at}}. A copy has been retained for
> HR records.
>
> **[View Write-up]**

---

### `writeup.refused` — Write-up — signature refused

**Subject:** Signature Refused — {{writeup.document_type}} for {{csr.username}}

**Body:**

> **Signature refused**
>
> Hi {{recipient.username}},
>
> [ROLE: agent]
> You declined to sign the **{{writeup.document_type}}** on
> {{formatDateTime writeup.refused_at}}.
>
> [ROLE: manager / creator / HR witness]
> {{csr.username}} refused to sign the **{{writeup.document_type}}** on
> {{formatDateTime writeup.refused_at}}.
>
> {{#if writeup.refusal_reason}}
> [ROLE: agent]
> **Reason on file**
> > {{writeup.refusal_reason}}
>
> [ROLE: manager / creator / HR witness]
> **Reason from agent**
> > {{writeup.refusal_reason}}
> {{/if}}
>
> **[Open Write-up]**
>
> [ROLE: agent]
> *Per policy, this document is filed in your employee record
> regardless of signature. If you'd like to add written comments, you
> can do so from the link above.*
>
> [ROLE: manager / creator / HR witness]
> **Next steps** — Per policy, document the witness's observation in
> the employee record within {{#if witnessSlaDays}}{{witnessSlaDays}}{{else}}3{{/if}}
> business days. The document will be filed regardless of signature.

---

### `writeup.followup_pending` — Write-up — follow-up pending

**Subject:** Follow-Up Due {{formatDate writeup.follow_up_date}} — {{csr.username}}

**Body:**

> **Write-up follow-up assigned to you**
>
> Hi {{recipient.username}},
>
> A **{{writeup.followup_type}}** has been assigned to you for
> {{csr.username}}'s **{{writeup.document_type}}**, due
> **{{formatDate writeup.follow_up_date}}**.
>
> **[Open Follow-up]**
>
> *When you've completed the follow-up, mark it complete from the link
> above so it's recorded in the employee file.*

---

## Digests

### `digest.csr_daily` — Daily CSR digest

**Subject:** QTIP Daily Summary — {{itemCount}} Reviews{{#if avgScore}}, Avg {{avgScore}}%{{/if}}

**Body:**

> **Today's AI reviews on your work**
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
> **Reviews today**
>
> | Form | Score | Status |
> |---|---:|---|
> | {{this.formName}} | {{this.score}}% | {{this.status}} | *(per item)* |
>
> {{#if hasMore}}*Showing the first {{itemCount}} of today's reviews.*{{/if}}
>
> **[View All in QTIP]**

---

### `digest.manager_weekly` — Weekly manager digest

**Subject:** Weekly QC — Team Avg {{teamAvg}}% ({{deltaLabel}}), {{itemCount}} Reviews

**Body:**

> **Your team's AI reviews this week**
>
> Hi {{recipient.username}},
>
> | | |
> |---|---|
> | Team average | **{{teamAvg}}%** ({{deltaLabel}} vs prior week) |
> | Reviews | **{{itemCount}}** |
> | Critical fails | **{{criticalFailCount}}** |
> | Disputes opened | {{disputesOpenedCount}} |
>
> **Top performers**
> - {{this.csrName}} — {{this.avg}}% ({{this.reviews}} reviews)   *(per item)*
>
> **Needs attention**
> - {{this.csrName}} — {{this.avg}}% ({{this.reviews}} reviews{{#if this.criticalFails}}, {{this.criticalFails}} critical{{/if}})   *(per item)*
>
> **[Open Team Dashboard]**

---

## Attendance

### `attendance_threshold_reached` — Attendance point threshold reached

Queued by a punch import's attendance recompute, one row per recipient. Goes to
the CSR who crossed (locked on) plus the named people on List Management >
Notifications > Alert Recipients. Fires once per rung per person, ever — see
`docs/insights_csr_attendance.md`.

The single template serves both audiences by branching on
`recipient.matchedRole`, so the subject and copy change for anyone who is not the
subject of the event.

**Subject (agent):** Attendance Points — {{level}} Threshold Reached
**Subject (everyone else):** Attendance Threshold Reached — {{csrName}} at {{level}}

**Body:**

> **Attendance point threshold reached**
>
> Hi {{recipient.username}},
>
> *(agent)* Your attendance points over the last 90 days have reached a threshold
> defined in the attendance policy.
> *(others)* An agent has reached an attendance point threshold defined in the
> attendance policy.
>
> | Agent* | Level | Points | Threshold | As of |
> |---|---|---|---|---|
> | {{this.csrName}} | {{this.level}} | {{this.points}} | {{this.threshold}} | {{this.asOf}} |
>
> \* Agent column is omitted in the agent's own copy.
>
> *Points are counted over a rolling 90-day window and roll off on their own as
> occurrences age out of it.*
>
> **[View Attendance]**
>
> *(agent only)* If something here looks wrong — a shift you were not scheduled
> for, or approved time off that was not applied — reply to your manager so it can
> be reviewed and corrected.

---

## System

### `system.circuit_tripped` — Email circuit-breaker tripped

**Subject:** [QTIP] Email Circuit-Breaker Tripped

**Body:**

> **Email circuit-breaker tripped**
>
> The QTIP email circuit-breaker has tripped.
>
> QTIP sent more than {{threshold}} emails in a 5-minute window. To
> protect users from a notification flood, **non-critical templates
> have been paused.** Critical templates (auth, system) continue to send.
>
> | | |
> |---|---|
> | Sends in window | **{{count}}** |
> | Top template | `{{topTemplate.key}}` ({{topTemplate.count}} sends) |
> | Tripped at | {{trippedAt}} |
> | Auto-resets at | {{resetsAt}} |
>
> **[Review Templates]**
>
> *Investigate the top template above for an unintended loop or trigger
> spike. Once the cause is fixed, the breaker will auto-reset; or you
> can manually clear it from the Email Templates → System Health tab.*
