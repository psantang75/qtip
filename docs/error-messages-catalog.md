# QTIP Error Message Catalog (Proposed)

**Status:** Draft for review. No code changes have been made.

This document inventories every user-visible error in QTIP across Auth/Admin, Quality, Training & Write-ups, and Insights, and proposes a standardized message for each one following industry best practice.

---

## 1. Scope and totals

A four-part inventory of every place an error can reach a user found:

- **~780 raw error sites** (frontend toasts, inline form errors, error banners, error boundaries, plus the backend 4xx/5xx responses that drive them).
- **~360 distinct user-visible scenarios** after collapsing duplicates that fire on the same code path.
- **~200 canonical messages** proposed below — most scenarios reuse one of 15 patterns, with bespoke wording reserved for business-rule errors that need specific context (e.g., "Closed or canceled sessions cannot be reopened").

Per-section breakdown of distinct user-visible scenarios:

- Auth + Admin + Global: ~70
- Quality: ~95
- Training + Write-ups: ~120
- Insights: ~75

---

## 2. Principles

These follow the conventions used by Linear, Stripe, GitHub, Atlassian, and the Nielsen Norman Group's error-message guidelines.

1. **Be plain, not robotic.** Use everyday English, not jargon or stack-trace text. Never expose codes like `ER_DUP_ENTRY`, `ECONNREFUSED`, or `TOKEN_BLACKLISTED` directly.
2. **Say what happened, in user terms.** "We couldn't save your changes." beats "Internal server error".
3. **Tell the user what to do next.** "Refresh to try again." / "Check your filters." / "Contact your administrator." Every error needs an action or an honest "we're looking into it."
4. **Don't blame the user.** "We couldn't save your changes." not "You failed to provide valid input."
5. **Be specific only when it helps.** "Email is required" beats "Validation error". But "We couldn't load the form" beats "GET /api/forms/123 returned 500".
6. **Two-line shape for toasts.** Title (≤6 words) is the headline. Description (one sentence) is the next step. Match shadcn's `<Toast title=... description=... />` pattern.
7. **Inline beats toast for form fields.** Field-level Zod messages stay inline. A single summary toast appears on submit when multiple fields fail.
8. **Keep voice consistent.** Sentence case for titles. Period at the end of descriptions, no period on titles. No emoji. No exclamation points. No "Oops!" / "Whoops!".
9. **Operational errors mention support, transient errors don't.** A 500 says "If this keeps happening, contact support and reference {correlationId}." A network blip just says "Check your connection and try again."
10. **Validation lists fields, not errors.** "Please fix 3 fields and try again." with the fields highlighted, not "answers[0].value: required, period_start: invalid date".

### Voice examples

| Bad | Good |
|---|---|
| Internal server error | We couldn't load this page. Refresh to try again. |
| Failed to update status | We couldn't update the status. Try again. |
| Token has been invalidated | Your session ended. Sign in again to continue. |
| Invalid form ID | This form no longer exists. It may have been deleted. |
| Unauthorized | You don't have permission to view this. |
| Failed to fetch | Can't reach the server. Check your connection and try again. |
| Quiz not found or access denied | This quiz isn't available to you. |

---

## 3. Canonical patterns (15)

Most errors reuse one of these. Each pattern lists the **title**, **description template**, and when to use it. Substitute `{noun}` and `{action}` per call site.

### P1. Load failure (GET)

- **Title:** Couldn't load {noun}
- **Description:** Refresh to try again. If this keeps happening, contact support.
- **Examples:** load forms list, load submissions, load coaching sessions, load reports.

### P2. Save failure (POST/PUT/PATCH)

- **Title:** Couldn't save changes
- **Description:** Your changes weren't applied. Try again.
- **Examples:** save form, save coaching session, save KPI description.

### P3. Delete failure (DELETE)

- **Title:** Couldn't delete {noun}
- **Description:** Try again. If this keeps happening, contact support.

### P4. Submit failure (terminal action — finalize, sign, schedule, publish)

- **Title:** Couldn't {action}
- **Description:** Try again. Your work hasn't been lost.
- **Examples:** submit audit, submit dispute, schedule write-up, sign write-up, finalize submission.

### P5. Field-level validation (inline, RHF/Zod)

- Stays inline next to the field. Sentence case, no period.
- Examples: "Email is required", "Password must be at least 8 characters", "Min 3 characters".

### P6. Form-level validation summary (toast on submit)

- **Title:** Please fix {N} field{s} and try again
- **Description:** {N} item{s} need attention before you can save.
- Used when multiple inline errors fire at once.

### P7. Permission denied (403)

- **Title:** You don't have access
- **Description:** Ask your administrator if you need access to this {noun}.
- **Examples:** non-admin loads Form Builder, agent opens another agent's profile.

### P8. Resource not found (404)

- **Title:** This {noun} no longer exists
- **Description:** It may have been deleted, moved, or your link is out of date.
- **Examples:** stale dispute link, deleted form, missing submission.

### P9. State conflict (409 / 422 — already-done, wrong-state, duplicate)

- **Title:** Can't {action} right now
- **Description:** {Specific reason} — examples: "This submission has already been finalized.", "This dispute is already resolved.", "An agent with this email already exists."

### P10. Session expired (401)

- **Title:** Session expired
- **Description:** Sign in again to continue. Your unsaved work is preserved on this page.
- Trigger: backend 401, blacklisted/expired JWT, refresh failure.

### P11. Rate-limited (429)

- **Title:** Too many requests
- **Description:** Wait a moment and try again.

### P12. Timeout / slow query (504)

- **Title:** This is taking too long
- **Description:** Narrow your filters or shorten your date range, then try again.

### P13. Network unreachable

- **Title:** Can't reach the server
- **Description:** Check your connection and try again.

### P14. Server error (500, unknown)

- **Title:** Something went wrong on our end
- **Description:** Try again. If this keeps happening, contact support and reference {correlationId}.
- The {correlationId} comes from the `X-Correlation-ID` response header (already produced by `backend/src/utils/errorHandler.ts`).

### P15. Upload failure (size / type / missing file)

- **Size:** "File is too large. Maximum size is {N} MB."
- **Type:** "File type not supported. Allowed: {types}."
- **Missing:** "Please choose a file to upload."
- **Server-side:** title "Upload failed", description "We couldn't save your file. Try again."

### Bonus: success messaging

For symmetry with errors, save-success toasts should be: title "Saved", description "(blank)". Avoid "Successfully saved!" with exclamation points.

---

## 4. Auth, Admin, and Global

### 4.1 Login

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 1 | Email empty | Email is required | (inline) | Email is required |
| 2 | Bad email format | Enter a valid email address | (inline) | Enter a valid email address |
| 3 | Password too short | Password must be at least 6 characters | (inline) | Password must be at least 6 characters |
| 4 | Wrong credentials | Login failed. Please check your credentials. / Invalid credentials | Sign-in failed | The email or password you entered is incorrect. |
| 5 | Account locked (too many tries) | Account temporarily locked due to failed login attempts | Account temporarily locked | Too many failed sign-in attempts. Try again in a few minutes or contact your administrator. |
| 6 | Account deactivated | Account is deactivated | Account is inactive | This account has been deactivated. Contact your administrator to restore access. |
| 7 | Auth service down | Authentication service unavailable | Sign-in is temporarily unavailable | We're having trouble signing you in. Try again in a moment. |
| 8 | Login rate-limited | Too many authentication attempts, please try again later | Too many sign-in attempts | Wait a few minutes before trying again. |
| 9 | Session expired redirect | Your session expired. Please sign in again. | Session expired | Sign in again to continue. |
| 10 | Missing email/password | Email and password are required | (inline both fields) | (handled by P5) |

### 4.2 Password reset

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 11 | Forgot-password submit (any outcome) | If that email exists, a reset link has been sent. | Check your email | If an account exists for that address, we've sent a password reset link. |
| 12 | Forgot-password network failure | (none — silent) | Couldn't send reset email | Try again in a moment. If this keeps happening, contact your administrator. |
| 13 | Reset password — too short | Password must be at least 8 characters | (inline) | Must be at least 8 characters |
| 14 | Reset — missing uppercase/lower/number/special | Must contain an uppercase letter / lowercase / number / special character | (inline, single line) | Use upper, lower, number, and a symbol |
| 15 | Reset — confirm mismatch | Passwords don't match | (inline) | Passwords don't match |
| 16 | Reset link invalid | We couldn't verify this link. Try requesting a new one. | Reset link isn't valid | Request a new password reset email and try again. |
| 17 | Reset link expired | This reset link has expired. Request a new one. | Reset link expired | These links expire after 1 hour. Request a new one to continue. |
| 18 | Reset link already used | This reset link has already been used. Request a new one if needed. | Reset link already used | Each link works only once. Request a new one if you still need to reset. |
| 19 | Reset server error | Password reset failed. | Couldn't reset password | Try again. If this keeps happening, contact support and reference {correlationId}. |

### 4.3 Session and token

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 20 | Any 401 in apiClient/authService | (silent redirect) | Session expired (banner on /login) | Sign in again to continue. |
| 21 | Token blacklisted | Token has been invalidated | Session ended | Sign in again to continue. |
| 22 | Token expired | Token expired, please login again | Session expired | Sign in again to continue. |
| 23 | Refresh failed | Token refresh failed / Refresh token expired | Session expired | Sign in again to continue. |
| 24 | Validate token error | Token validation failed | Session check failed | Refresh the page. If this keeps happening, sign out and sign back in. |

### 4.4 Access / role guard

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 25 | Insufficient role on protected route | Access Restricted / You don't have permission to view this page. | You don't have access | Ask your administrator if you need access to this section. |
| 26 | Backend 403 (admin/qa/trainer/manager guard) | Access denied. {Role} role required | (route guard handles UI) | (P7) |
| 27 | Recording route guard | Access denied. Recording access is restricted to QA reviewers and supervisors. | You don't have access to recordings | Recordings are only available to QA reviewers and supervisors. |

### 4.5 Profile

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 28 | Username < 3 | Min 3 characters | (inline) | Must be at least 3 characters |
| 29 | Bad email | Valid email required | (inline) | Enter a valid email address |
| 30 | Current password empty | Required | (inline) | Current password is required |
| 31 | New password rules (FE shows < 6, BE requires 8) | Min 6 characters | (inline) | Must be at least 8 characters with upper, lower, number, and a symbol |
| 32 | Wrong current password | Current password is incorrect | Couldn't change password | The current password you entered is incorrect. |
| 33 | New = current | New password must be different from current password | (inline) | New password must be different from your current one |
| 34 | Profile save failure | (dynamic e.message) | Couldn't save profile | Try again. If this keeps happening, contact support. |
| 35 | Password change failure | (dynamic e.message) | Couldn't change password | Try again. If this keeps happening, contact support. |

### 4.6 Admin — Users

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 36 | Toggle active/inactive failed | Failed to update status | Couldn't update user | Try again. |
| 37 | Unlock account failed | Failed to unlock account | Couldn't unlock account | Try again. |
| 38 | Users list load failed | Failed to load users. | Couldn't load users | Refresh to try again. |
| 39 | Create — duplicate email | This email address is already in use. | Email already in use | Choose a different email or check if the user already exists. |
| 40 | Create — duplicate username | This username is already taken. | Username already taken | Choose a different username. |
| 41 | Update — user not found | User not found. Please refresh and try again. | User no longer exists | Refresh the list and try again. |
| 42 | Self-deactivate attempt | Can't deactivate yourself | (tooltip) | You can't deactivate your own account |
| 43 | Self-delete attempt | Cannot delete your own account | Can't delete yourself | You can't delete your own account. |
| 44 | Cannot deactivate self | Cannot deactivate your own account | Can't deactivate yourself | You can't deactivate your own account. |
| 45 | Locked account badge tooltip | Locked out from repeated failed sign-ins | (tooltip — keep as-is) | Locked out after repeated failed sign-ins |
| 46 | Field — username min/format | Min 3 characters / username can only contain letters... | (inline) | 3+ characters, letters, numbers, and underscore only |
| 47 | Field — password complexity (admin form) | Min 8 characters / Add an uppercase letter / etc. | (inline) | Must be at least 8 characters with upper, lower, number, and a symbol |
| 48 | Field — invalid role | Invalid role ID | (inline on Role) | Choose a valid role |
| 49 | Bad response shape | Invalid response format from server | Couldn't load this page | Refresh to try again. If this keeps happening, contact support. |
| 50 | Generic create/update failure | (dynamic apiError) | Couldn't save user | (P2) |

### 4.7 Admin — Departments

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 51 | Department load failed | Failed to load departments. | Couldn't load departments | Refresh to try again. |
| 52 | Toggle status failed | Failed to update status | Couldn't update department | Try again. |
| 53 | Name min length | Min 2 characters | (inline) | Must be at least 2 characters |
| 54 | Duplicate name | Department name already exists | Department name already exists | Choose a different name. |
| 55 | Self-parent | A department cannot be its own parent | Invalid parent | A department can't be its own parent. |
| 56 | Circular parent | Cannot set parent to a child department (circular reference) | Invalid parent | The parent you chose is already a sub-department. Pick a different one. |
| 57 | Delete with assigned users | Cannot delete department with assigned users. Please reassign users first. | Department has members | Reassign users to another department before deleting this one. |
| 58 | Generic create/update failure | (dynamic apiError) | Couldn't save department | (P2) |

### 4.8 Admin — Roles

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 59 | User-count load failed | Failed to load user counts. | Couldn't load roles | Refresh to try again. |
| 60 | Roles list backend 500 | Failed to fetch roles | (covered by 59) | (P1) |

### 4.9 Admin — Email templates

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 61 | Save template failed | Save failed / Try again. | Couldn't save template | Try again. |
| 62 | Test send failed | Test failed / Send error. | Couldn't send test | Check the recipient address and try again. |
| 63 | Resend failed | Resend failed / Try again. | Couldn't resend email | Try again. |
| 64 | Unknown merge variables | Unknown variables: {bad}. Allowed: {allowed}. | Unknown variables in template | These variables aren't recognized: {bad}. Allowed variables: {allowed}. |
| 65 | Render preview failed | Render failed / Failed to render template | Couldn't render preview | Check your template syntax and try again. |
| 66 | Test send missing recipient | "to" is required | (inline on To field) | Enter a recipient email address |
| 67 | Reset, no seed | No filesystem default exists for this template | Can't reset this template | This template has no built-in default to reset to. |
| 68 | Stale resend | Template no longer exists | Template was removed | This template has been deleted. Pick another to resend. |
| 69 | Health: SMTP unreachable / not configured | (dynamic) / not configured | (status card — keep neutral) | SMTP isn't configured. Set up SMTP credentials in System Settings. |

### 4.10 Admin — List management

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 70 | List load failed | Failed to load list items. | Couldn't load list | Refresh to try again. |
| 71 | Save item failed | Save failed | Couldn't save item | Try again. |
| 72 | Toggle active failed | Update failed | Couldn't update item | Try again. |
| 73 | Add item failed | Add failed | Couldn't add item | Try again. |
| 74 | Reorder failed | Reorder failed | Couldn't save new order | Try again. |
| 75 | Delete failed | Delete failed | Couldn't delete item | Try again. |
| 76 | Clear category failed | Failed to remove category | Couldn't remove category | Try again. |
| 77 | Backend missing fields | list_type and label are required | (inline on the form) | (P5) |

### 4.11 Admin — System settings (KB scheduler)

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 78 | Settings load failed | Failed to load settings: {error.message} | Couldn't load settings | Refresh to try again. |
| 79 | Save interval failed | Failed to save interval: {message} / unknown error | Couldn't save changes | Try again. |
| 80 | Bad interval value | interval_min must be a number | (inline) | Enter a number of minutes |

### 4.12 Global — network, CSRF, timeout, rate limit

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 81 | Axios timeout | timeout of {N}ms exceeded | This is taking too long | Check your connection and try again. (P12) |
| 82 | API rate limit (429) | Too many API requests, please try again later | Too many requests | Wait a moment and try again. |
| 83 | Missing/bad Content-Type | Content-Type header is required... / Unsupported Content-Type | Something went wrong | Refresh and try again. (P14, internal) |
| 84 | Body too large (413) | Request entity too large | File or request too large | Try a smaller file or fewer items at once. |
| 85 | CSRF token failure | invalid csrf token | Session needs to refresh | Refresh the page and try again. |
| 86 | Query timeout (504) | The request took too long to complete. Please narrow your filters and try again. | This is taking too long | Narrow your filters or shorten your date range, then try again. |
| 87 | DB connection (503) | Database connection error | We're having trouble loading | Try again in a moment. We're aware and looking into it. |
| 88 | Unknown 500 (prod) | An internal server error occurred | Something went wrong on our end | Try again. If this keeps happening, contact support and reference {correlationId}. |
| 89 | Route not found (404) | Route {url} not found | Page not found | The page you're looking for doesn't exist. |
| 90 | ApiErrors.notFound default | Resource not found | (P8) | (P8) |

### 4.13 Global — error boundary and shared

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 91 | Uncaught render error | Something went wrong / The page ran into an unexpected error... | Something went wrong on this page | Try again, or refresh to load the latest version. (Buttons: Try again / Reload page) |
| 92 | TableErrorState default | Failed to load data. | Couldn't load this table | Refresh to try again. |
| 93 | Duplicate call selector | This call has already been added. | (inline) | This call has already been added |
| 94 | Empty call ID | Call ID is required. | (inline) | Call ID is required |
| 95 | Ticket/task ID empty | {Task/Ticket} ID is required. | (inline) | Enter a {ticket/task} ID |
| 96 | Ticket/task ID non-digit | ID must be digits only. | (inline) | Enter digits only |
| 97 | Ticket/task ID non-positive | ID must be a positive integer. | (inline) | Enter a number greater than zero |
| 98 | Duplicate ticket/task | That ticket/task is already added. | (inline) | This {ticket/task} is already added |
| 99 | Ticket/task not found | {Task/Ticket} {id} not found in CRM. | (inline) | We couldn't find {ticket/task} {id} in the CRM |
| 100 | CRM unreachable | Could not reach CRM. Try again. | (inline) | We can't reach the CRM. Try again. |
| 101 | Notes load fail | Failed to load notes. | (inline) | Couldn't load notes |
| 102 | CRM data load fail | Failed to load CRM data. | (inline) | Couldn't load CRM data |
| 103 | No audio recording | No audio recording available | (status text — keep) | No audio recording available |

---

## 5. Quality

### 5.1 Audit Forms / Form Builder

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 104 | Non-admin opens Form Builder | You don't have permission to access Form Builder. | You don't have access | Form Builder is restricted to administrators. Ask your admin if you need access. |
| 105 | Form name empty | Form name is required. | (inline) | Form name is required |
| 106 | No categories | Add at least one category. | (inline summary) | Add at least one category to continue |
| 107 | Weights ≠ 100% | Weights sum to {N}% — must be 100%. / Category weights must sum to 100%. | Weights don't add up | Categories must total exactly 100%. They currently total {N}%. |
| 108 | No questions | Add at least one question. | (inline summary) | Add at least one question to continue |
| 109 | Form save failed | Save failed / Please try again. / (dynamic e.message) | Couldn't save form | Your changes weren't saved. Try again. |
| 110 | Form list load failed | Failed to load forms. | Couldn't load forms | Refresh to try again. |
| 111 | Inline weight bar over 100 | Exceeds 100% — reduce weights | (inline) | Over 100% — reduce some weights |
| 112 | Question text empty | Question text is required | (inline) | Question text is required |
| 113 | Need options for radio/multi-select | Add at least one option | (inline) | Add at least one option |
| 114 | Scale min ≥ max | Scale min must be less than max | (inline) | Minimum must be less than maximum |
| 115 | Conditional missing source | All conditions need a source question | (inline) | Each condition needs a source question |
| 116 | Roll-up — no members | Roll-up must have at least one member question | (inline) | Pick at least one member question |
| 117 | Roll-up — self member | Roll-up cannot include itself as a member | (inline) | A roll-up can't include itself |
| 118 | Roll-up — nested | Nested roll-ups are not supported; pick DETAIL questions only | (inline) | Members must be detail questions, not other roll-ups |
| 119 | Roll-up — cross-category | Roll-up members must live in the same category as the roll-up question | (inline) | All members must be in the same category as the roll-up |
| 120 | Radio option empty | Option label is required | (inline) | Option label is required |
| 121 | Form not found (BE) | Form not found | This form no longer exists | It may have been deleted. Return to Forms. (P8) |
| 122 | Backend create/update generic | An unexpected error occurred while creating/updating the form. Please try again. | Couldn't save form | Try again. If this keeps happening, contact support. |

### 5.2 Review Forms / Audit Form

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 123 | Forms list load | Failed to load forms. | Couldn't load forms | Refresh to try again. |
| 124 | AI draft 403 (not AI draft) | This submission is not an AI Reviewer draft / The AI draft endpoint only exposes drafts owned by the AI Reviewer system user… | Not an AI draft | This submission isn't an AI Reviewer draft. Open it from your normal review queue. |
| 125 | AI draft 404 | Submission {id} not found / It may have been deleted or the link is stale. | Submission not found | This draft no longer exists or your link is out of date. |
| 126 | AI draft 409 (already promoted) | This submission is no longer a draft / It has already been promoted or submitted… | This draft has been finalized | This AI draft has already been promoted. Open the finalized submission instead. |
| 127 | AI draft other error | Failed to load the AI draft / Unknown error. | Couldn't load AI draft | Refresh to try again. |
| 128 | Submit audit failed | Failed to submit. Please try again. | Couldn't submit review | Your answers haven't been submitted. Try again. |
| 129 | Save draft failed | Failed to save draft. Please try again. | Couldn't save draft | Try again. Your work is still on this page. |
| 130 | Required form details missing | Please fill in all required form details:\n- {field}... | Please complete the form | {N} required {detail/details} still need to be filled in. |
| 131 | Required questions missing | Please answer all required questions:\n- {question}... | Please answer all required questions | {N} required {question/questions} still need answers. |
| 132 | Review form load failed | Failed to load review form. | Couldn't load this form | Refresh to try again. |
| 133 | Promote draft — no answers | Body must include a non-empty answers[] array. | Couldn't promote draft | Add at least one answer before promoting. |
| 134 | Promote draft — wrong status | Submission {id} is {STATUS}, not DRAFT — cannot promote. | This draft has been finalized | This AI draft has already been promoted to a {status} submission. |
| 135 | Calibration overlay — wrong source | Calibration overlay requires a SUBMITTED AI source (got {STATUS}). | Can't add overlay yet | Calibration overlays can only be added to submitted AI reviews. |
| 136 | Calibration overlay — no link | AI submission has no ticket/task link; cannot create a calibration overlay. | Missing source link | This AI submission isn't linked to a ticket or task, so it can't be calibrated. |

### 5.3 Submissions

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 137 | Submissions list load | Failed to load submissions. | Couldn't load submissions | Refresh to try again. |
| 138 | Detail load | Failed to load submission details. | Couldn't load this submission | Refresh to try again. |
| 139 | CSR finalize ("accept review") failed | Please try again. (title: Failed to accept review) | Couldn't accept review | Try again. If this keeps happening, contact support. |
| 140 | Resolve dispute — empty notes | Resolution notes are required. | (inline) | Resolution notes are required |
| 141 | Resolve dispute failed | Failed to resolve dispute. / (dynamic) | Couldn't resolve dispute | Try again. |
| 142 | Already finalized | Submission is already finalized | Already finalized | This submission has already been finalized. |
| 143 | Disputed cannot finalize | Cannot finalize a disputed submission | Can't finalize while disputed | Resolve the dispute before finalizing. |
| 144 | CSR finalize not allowed | Cannot finalize submission. It may not exist, not belong to you, or not be in the correct status. | Can't accept this review | This review can't be accepted. It may not be assigned to you, or its status changed. |

### 5.4 Disputes

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 145 | Disputes list load | Failed to load disputes. | Couldn't load disputes | Refresh to try again. |
| 146 | Submit dispute failed | Failed to submit dispute. | Couldn't submit dispute | Try again. Your draft is still on this page. |
| 147 | Min char hint | {N} more characters needed | (inline) | {N} more characters needed |
| 148 | Update dispute failed | Failed to update dispute. | Couldn't update dispute | Try again. |
| 149 | File too large | File must be under 5 MB | (inline) | File must be under 5 MB |
| 150 | Wrong file type | Only PDF, DOC, DOCX, JPG, PNG allowed | (inline) | Allowed file types: PDF, DOC, DOCX, JPG, PNG |
| 151 | Reason too long | Dispute reason must be less than 1000 characters | (inline) | Keep your reason under 1000 characters |
| 152 | Audit already disputed | Audit already has an active dispute | Already in dispute | This audit already has an open dispute. |
| 153 | Dispute not editable | Dispute not found, not accessible, or cannot be edited | Can't edit this dispute | This dispute has been resolved or is no longer accessible. |
| 154 | Manager — resolve fields missing | Resolution action and notes are required | (inline) | Choose an action and add resolution notes |
| 155 | Manager — score out of range | New score must be between 0 and 100 | (inline) | Enter a score between 0 and 100 |
| 156 | Manager — training id missing | Training ID is required for training assignment | (inline) | Pick a training to assign |

### 5.5 Quality Analytics

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 157 | No date range | Please select a date range. | Pick a date range | Choose a start and end date to run this report. |
| 158 | Report query error | Failed to generate report. | Couldn't run report | Adjust your filters and try again. |

### 5.6 AI Reviewer — list / inbox / shell

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 159 | AI forms list | Failed to load AI-enabled forms. | Couldn't load AI forms | Refresh to try again. |
| 160 | AI inbox | Failed to load AI inbox. | Couldn't load AI inbox | Refresh to try again. |
| 161 | Invalid form id | Invalid form id. | Form not found | This form doesn't exist or has been removed. |
| 162 | Form load fail | Could not load this form. | Couldn't load form | Refresh to try again. |
| 163 | AI Reviewer not configured | AI Reviewer is not configured. / AI Reviewer user id missing. | AI Reviewer isn't set up | An administrator needs to configure AI Reviewer before this feature can be used. |

### 5.7 AI Reviewer — Manual Run

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 164 | Run failed (generic) | AI run failed | AI run failed | We couldn't run the AI review. Try again. |
| 165 | Run failed (with code) | (dynamic error + code) | AI run failed | {server message}. Try again or pick a different ticket/form. |
| 166 | Compare runs failed | Run failed / (per-provider message) | AI run failed | We couldn't complete the comparison. Try again. |
| 167 | Bad ticket id / external_id | Invalid ticket id... / external_id required | (inline) | Enter a valid {ticket/task/conversation} ID |
| 168 | Bad provider/tier combo | model_tier='alt' is only supported when provider is 'anthropic'... | Invalid AI settings | This combination of provider and tier isn't supported. |
| 169 | Form not AI-enabled | Form "{name}" is not AI-enabled… | This form isn't AI-enabled | Enable AI review for this form before running. |
| 170 | Too many sources | Too many attached sources… | Too many attached sources | Limit attached sources to {N}. |
| 171 | Ticket/task not in CRM | Ticket/Task {id} not found in CRM | Not found in CRM | We couldn't find {kind} {id} in the CRM. |
| 172 | Conversation no transcript | Conversation {id} has no transcript… | No transcript available | This conversation doesn't have a transcript yet. |
| 173 | Source not closed | {KIND} {id} is not closed (current status: ...) | Source isn't ready for review | {Kind} {id} is still {status}. AI review only runs on closed items. |
| 174 | LLM provider not configured | Anthropic/OpenAI/BookStack is not configured… | AI provider isn't set up | An administrator needs to configure {provider} before this feature can be used. |
| 175 | LLM JSON parse fail | Anthropic/OpenAI failed to return valid JSON… | AI returned an invalid response | We couldn't parse the AI's response. Try again or contact support. |
| 176 | LLM missing answer | Claude did not answer question_id=… | Incomplete AI response | The AI didn't answer every question. Try running again. |
| 177 | Form has no AI question | Form missing AI Reviewer Feedback question… | Form is missing the AI feedback question | Add the AI Reviewer Feedback question to this form before running. |
| 178 | Source material failed | Primary source material failed to load | Couldn't load source material | We couldn't load the {ticket/task/conversation} content. Try again. |

### 5.8 AI Reviewer — Settings

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 179 | Save settings failed | Try again | Couldn't save settings | Try again. |
| 180 | Sample pct out of range | ai_sample_review_pct must be 0..100. | (inline) | Enter a number between 0 and 100 |
| 181 | Threshold out of range | ai_sample_low_confidence_threshold must be 0..1 (or null). / ai_disagreement_route_threshold must be 0..1 (or null). | (inline) | Enter a value between 0 and 1, or leave blank |
| 182 | Guidance too long | ai_review_guidance must be {N} characters or fewer… | (inline) | Keep guidance under {N} characters |
| 183 | Bad provider value | ai_model_provider must be one of: anthropic, openai. | (inline) | Choose Anthropic or OpenAI |
| 184 | Empty patch | Body must include at least one calibration setting. | Nothing to save | Make a change before saving. |
| 185 | Form not AI-enabled (settings) | Form is not AI-enabled. | This form isn't AI-enabled | Enable AI review for this form first. |

### 5.9 AI Reviewer — Rule Packs

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 186 | Rule packs load | Failed to load rule packs. / Could not load rule packs. Check backend logs. | Couldn't load rule packs | Refresh to try again. |
| 187 | Archive failed | (dynamic) | Couldn't archive rule pack | Try again. |
| 188 | Restore failed | (dynamic) | Couldn't restore rule pack | Try again. |
| 189 | Save pack failed | (dynamic) | Couldn't save rule pack | Try again. |
| 190 | Save assignments failed | Try again / (dynamic) | Couldn't save assignments | Try again. |
| 191 | Bad pack key | key is required / key must be lowercase alphanumeric with dashes… | (inline) | Use lowercase letters, numbers, and dashes only |
| 192 | Required pack fields | name is required / owner_dept is required / body_md is required | (inline) | (P5) |
| 193 | Unknown rule pack key | Unknown rule pack "{key}" | (inline on key field) | We don't recognize the rule pack "{key}" |

### 5.10 AI Reviewer — Base Prompts

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 194 | Base prompts list load | Failed to load base prompts. | Couldn't load base prompts | Refresh to try again. |
| 195 | Archive base failed | (dynamic) | Couldn't archive prompt | Try again. |
| 196 | Set default failed | (dynamic) | Couldn't set as default | Try again. |
| 197 | Save base failed | (dynamic) | Couldn't save prompt | Try again. |
| 198 | Rollback failed | (dynamic) | Couldn't roll back prompt | Try again. |
| 199 | Preview load fail | Failed to load: {message} | Couldn't load preview | Refresh to try again. |
| 200 | Archive default | Cannot archive the default base for its kind. Set another base as default first. | Can't archive the default | Set another prompt as the default before archiving this one. |
| 201 | Default = archived | Cannot set an archived base as default | Can't make archived prompt default | Restore this prompt before making it the default. |
| 202 | No default | No default base prompt configured for kind "{kind}" | No default prompt set | Pick a default {kind} prompt before running. |

### 5.11 AI Reviewer — Question Rubrics

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 203 | Rubrics load | Failed to load rubrics. Try again in a moment. | Couldn't load rubrics | Refresh to try again. |
| 204 | Save rubric failed | (dynamic) | Couldn't save rubric | Try again. |
| 205 | Delete rubric failed | (dynamic) | Couldn't remove rubric | Try again. |

### 5.12 AI Reviewer — Prompt Preview

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 206 | Preview build fail | Failed to load: {message} / Failed to build prompt preview | Couldn't build prompt preview | Refresh to try again. |

### 5.13 AI Reviewer — Learned Corrections

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 207 | Active corrections load | Failed to load corrections preview. | Couldn't load corrections | Refresh to try again. |
| 208 | Absorbed load | Failed to load absorbed corrections. | Couldn't load absorbed corrections | Refresh to try again. |
| 209 | Mark absorbed failed | Unknown error / (dynamic) | Couldn't mark as absorbed | Try again. |

### 5.14 AI Reviewer — Calibration Metrics & Map

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 210 | Metrics load | Failed to load metrics. | Couldn't load metrics | Refresh to try again. |
| 211 | Fit map failed | (dynamic) | Couldn't fit calibration map | Try again. |
| 212 | Activate map failed | (dynamic) | Couldn't activate map | Try again. |
| 213 | Not enough data | Not enough reviewed submissions to fit (need {min}, have {n}). | Not enough data to calibrate | Need at least {min} reviewed submissions to fit a calibration map. You have {n}. |
| 214 | Map not found | Calibration map {mapId} not found for form {formId} | Map no longer exists | This calibration map has been removed. Refresh to see current maps. |
| 215 | Bad reset confirm | confirm must equal "RESET" — this destroys the form's rolling calibration set. | Confirmation didn't match | Type "RESET" exactly to confirm. |

### 5.15 AI Reviewer — Golden Set & Eval

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 216 | Archive golden failed | (dynamic) | Couldn't archive golden row | Try again. |
| 217 | Run eval failed | Unknown error / (dynamic) | Couldn't run evaluation | Try again. |
| 218 | Eval regressed (informational, destructive toast) | kappa = {k} on {n} of {m} golden submissions. | Evaluation regressed | Kappa dropped to {k} on {n} of {m} golden submissions. Review recent prompt or rubric changes. |

### 5.16 AI Reviewer — KB & Diagnostics

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 219 | KB coverage load | Failed to load KB coverage. Try again in a moment. | Couldn't load KB coverage | Refresh to try again. |
| 220 | Readiness/drift/cost load | Failed to load mode readiness / drift status / cost status | Couldn't load AI status | Refresh to try again. |

---

## 6. Training and Write-ups

### 6.1 Coaching Sessions (trainer/QA/admin)

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 221 | Sessions list load | Failed to load training sessions. | Couldn't load coaching sessions | Refresh to try again. |
| 222 | No agent selected | Select at least one Agent | (inline) | Pick at least one agent |
| 223 | No date | Date is required | (inline) | Date is required |
| 224 | No purpose | Select a coaching purpose | (inline) | Pick a coaching purpose |
| 225 | No format | Select a coaching format | (inline) | Pick a coaching format |
| 226 | No source | Select a source | (inline) | Pick a source |
| 227 | Empty notes | Notes are required | (inline) | Notes are required |
| 228 | No topics | Select at least one topic | (inline) | Pick at least one topic |
| 229 | Follow-up date missing | Follow-up date is required | (inline) | Follow-up date is required |
| 230 | Save draft failed | Save failed / Please try again. | Couldn't save draft | Try again. Your work is still on this page. |
| 231 | Schedule failed | Save failed / Please try again. | Couldn't schedule session | Try again. |
| 232 | Edit form load | Failed to load training session. | Couldn't load this session | Refresh to try again. |
| 233 | Save section (detail) | Save failed | Couldn't save changes | Try again. |
| 234 | Save & close | Save & close failed | Couldn't save and close | Try again. |
| 235 | Manual status change | Could not update status. | Couldn't update status | Try again. |
| 236 | Deliver failed | Could not deliver session. | Couldn't deliver session | Try again. |
| 237 | Download attachment | Download failed | Couldn't download file | Try again. |
| 238 | Detail load | Failed to load session. | Couldn't load this session | Refresh to try again. |
| 239 | Invalid coach | Invalid or ineligible coach | Pick a different coach | This person can't be assigned as a coach. |
| 240 | CSR not active | CSR {id} not found or inactive | Agent isn't active | One of the selected agents is inactive. Remove them or pick another agent. |
| 241 | Topic invalid | One or more topics are invalid or inactive | Topic isn't available | One or more selected topics are inactive. Pick different topics. |
| 242 | Closed/canceled edit | Cannot edit a closed or canceled session | Can't edit this session | Closed or canceled sessions can't be edited. |
| 243 | Schedule from non-DRAFT | Can only schedule a DRAFT session | Already scheduled | This session has already been scheduled or completed. |
| 244 | Already complete | Session is already completed or closed | Already completed | This session is already complete. |
| 245 | Already closed | Session is already closed | Already closed | This session is already closed. |
| 246 | Reopen closed/canceled | Closed or canceled sessions cannot be reopened | Can't reopen this session | Closed or canceled sessions can't be reopened. |
| 247 | Legacy locked | This is a legacy record imported from the previous system and is read-only. Contact an administrator if it must be changed. | This record is read-only | This was imported from the previous system and can't be edited. Contact an administrator if it must change. |
| 248 | Attachment file gone | Attachment file not found on server | Attachment is missing | We couldn't find this file on the server. It may have been removed. |
| 249 | Session not found / no access | Session not found or access denied | Session not available | This session no longer exists or you don't have access to it. |

### 6.2 My Coaching (CSR)

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 250 | List load | Failed to load training sessions. | Couldn't load your coaching | Refresh to try again. |
| 251 | Submit action plan / acknowledgment | Submit failed / Please try again. | Couldn't submit | Try again. Your response is still on this page. |
| 252 | Download attachment | Download failed | Couldn't download file | Try again. |
| 253 | Detail load | Failed to load training session. | Couldn't load this session | Refresh to try again. |
| 254 | Action plan too short | {n}/1000 (X more needed) | (inline counter — keep) | {n}/1000 ({X} more needed) |
| 255 | Action plan min (BE) | Action plan must be at least 50 characters | (inline) | Write at least 50 characters |
| 256 | Acknowledgment missing | Acknowledgment is required | (inline) | You must acknowledge before submitting |
| 257 | Page out of range | Page must be a number between 1 and 10000 | (inline) | (P5 — silent) |
| 258 | Date format bad (filter) | Start/End date must be in valid format (YYYY-MM-DD) | (inline) | Pick a valid date |
| 259 | Bad status filter | Status must be either SCHEDULED or COMPLETED | (inline) | Pick Scheduled or Completed |
| 260 | Resource not found | Resource not found or access denied | Resource not available | This resource no longer exists or you don't have access to it. |
| 261 | File missing | File not found on server | File is missing | We couldn't find this file on the server. |
| 262 | File too large to download | File too large to download | File is too large | This file is over the download limit. Contact your trainer for another way to share it. |
| 263 | Type unsupported | File type not supported for download | File type not supported | This file type can't be downloaded. |
| 264 | Not awaiting CSR response | Session is not awaiting a CSR response | Already responded | You've already responded to this session. |

### 6.3 Quiz Player

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 265 | Submit failed | Quiz submission failed / Please try again. | Couldn't submit quiz | Your answers weren't submitted. Try again. |
| 266 | Quiz not passed | Not Passed / Required score: {pass_score}% | (result screen — keep) | Not passed — minimum score is {pass_score}% |
| 267 | Quiz has no questions | Quiz has no questions | Quiz isn't ready | This quiz doesn't have any questions yet. Contact your trainer. |
| 268 | Wrong answer count | Number of answers does not match number of questions | Couldn't submit quiz | Some answers are missing. Answer all questions and try again. |
| 269 | Not authorized for session | You are not authorized to submit a quiz attempt for this coaching session | You don't have access | This quiz isn't assigned to you in this coaching session. |

### 6.4 Library — Quizzes

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 270 | Empty title | Quiz title is required | (inline) | Quiz title is required |
| 271 | Pass score range | Pass score must be between 1 and 100 | (inline) | Enter a value between 1 and 100 |
| 272 | No questions | Add at least one question | (inline) | Add at least one question |
| 273 | Empty question text | Question text is required | (inline) | Question text is required |
| 274 | Need 2+ options | At least 2 non-empty options required | (inline) | Add at least 2 answer options |
| 275 | Wrong option count (BE) | Each question must have 2-4 options | (inline) | Each question needs 2 to 4 options |
| 276 | Bad correct option | correct_option must be a valid 0-based index | (inline) | Pick the correct answer |
| 277 | Save failed | Save failed / (dynamic) | Couldn't save quiz | Try again. |
| 278 | Edit load | Failed to load quiz. | Couldn't load this quiz | Refresh to try again. |
| 279 | Toggle status | Failed to update status | Couldn't update quiz | Try again. |
| 280 | Preview load | Failed to load quiz preview | Couldn't load preview | Refresh to try again. |
| 281 | List load | Failed to load quizzes. | Couldn't load quizzes | Refresh to try again. |
| 282 | No published course (BE) | No published course found for quiz assignment | Can't save quiz | This quiz needs to be linked to a published course before saving. |
| 283 | Delete with attempts | This quiz has recorded attempts and cannot be deleted | Can't delete this quiz | Agents have already taken this quiz, so it can't be deleted. Deactivate it instead. |

### 6.5 Library — Resources

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 284 | Title empty | Title is required | (inline) | Title is required |
| 285 | Bad URL | Enter a valid URL (https://...) | (inline) | Enter a valid URL starting with https:// |
| 286 | No file (file resource) | Please select a file to upload | (inline) | Choose a file to upload |
| 287 | Save failed | Save failed / (dynamic) | Couldn't save resource | Try again. |
| 288 | List load | Failed to load resources. | Couldn't load resources | Refresh to try again. |
| 289 | Toggle (no `is_active`) | is_active is required | (internal) | (P14) |
| 290 | Resource not found | Resource not found | Resource not available | This resource no longer exists. Refresh to see current resources. |
| 291 | File not found | File not found / File not found on server | File is missing | We couldn't find this file on the server. |
| 292 | Token expired (resource view) | Invalid or expired token | Link expired | This resource link is no longer valid. Open it from your training page. |
| 293 | Unsupported upload type | Unsupported file type | File type not supported | Allowed types: {types}. |

### 6.6 Library — Topics

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 294 | Save linkages | Failed to save topic | Couldn't save topic | Try again. |
| 295 | Preview quiz | Failed to load quiz preview | Couldn't load preview | Refresh to try again. |
| 296 | List load | Failed to load topics. | Couldn't load topics | Refresh to try again. |

### 6.7 Training Reports

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 297 | Summary load | Failed to load summary metrics. | Couldn't load summary | Refresh to try again. |
| 298 | Coaching table load | Failed to load coaching data. | Couldn't load report | Adjust your filters and try again. |

### 6.8 Trainer dashboard / submissions / filters

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 299 | Stats load | Failed to fetch training statistics | Couldn't load stats | Refresh to try again. |
| 300 | Dashboard stats load | Failed to fetch trainer dashboard statistics | Couldn't load dashboard | Refresh to try again. |
| 301 | CSR activity load | Failed to fetch CSR activity data | Couldn't load activity | Refresh to try again. |
| 302 | Team CSRs load | Failed to fetch team CSRs (Internal server error) | Couldn't load your team | Refresh to try again. |
| 303 | Completed submissions list | Failed to fetch completed submissions | Couldn't load completed reviews | Refresh to try again. |
| 304 | Submission detail | Failed to fetch submission details | Couldn't load this submission | Refresh to try again. |
| 305 | Filter options | Failed to fetch filter options | Couldn't load filters | Refresh to try again. |
| 306 | Run report | Failed to generate report | Couldn't run report | Adjust your filters and try again. |
| 307 | Trainer health | Health check failed | Service is degraded | Some training features may be slow or unavailable right now. |

### 6.9 Write-ups — List

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 308 | Manager list load | Failed to load performance warnings. | Couldn't load performance warnings | Refresh to try again. |
| 309 | CSR list load | Failed to load performance warnings. | Couldn't load your warnings | Refresh to try again. |

### 6.10 Write-ups — Form

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 310 | No employee | Please select an employee | (inline / toast) | Pick an employee to continue |
| 311 | No doc type | Please select a document type | (inline) | Pick a document type |
| 312 | Manager = HR Witness | Manager and HR Witness cannot be the same person | (inline) | Manager and HR Witness must be different people |
| 313 | No meeting date (schedule) | Meeting date is required to schedule | (inline) | Meeting date is required to schedule |
| 314 | No manager (schedule) | Manager is required to schedule | (inline) | Manager is required to schedule |
| 315 | No HR witness (schedule) | HR Witness is required to schedule | (inline) | HR Witness is required to schedule |
| 316 | No incident description | At least one incident with a description is required to schedule | (inline) | Add at least one incident with a description |
| 317 | No violation | At least one incident must include a violation to schedule | (inline) | Add at least one violation to an incident |
| 318 | No policy | At least one violation must have a policy specified to schedule | (inline) | Pick a policy for each violation |
| 319 | No example | At least one violation must include an example with a description to schedule | (inline) | Add at least one example with a description |
| 320 | API Zod validation summary | Please fix the following / {field}: {message} per field | Please fix {N} field(s) | Some fields need attention before you can save. |
| 321 | Save/schedule failed | Save failed / (dynamic) | Couldn't save warning | Try again. Your work is still on this page. |
| 322 | Edit load | Failed to load performance warning. | Couldn't load this warning | Refresh to try again. |
| 323 | Locked for editing | Document locked for editing / This performance warning cannot be edited once it has been sent for signature. | Locked for editing | Once a warning is sent for signature, it can't be edited. |
| 324 | Delete attachment | Could not remove attachment. | Couldn't remove attachment | Try again. |
| 325 | Create linked coaching | Failed to create session / (dynamic) | Couldn't create session | Try again. |

### 6.11 Write-ups — Detail

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 326 | Duplicate to draft | Duplicate failed | Couldn't duplicate | Try again. |
| 327 | Detail load | Failed to load performance warning. | Couldn't load this warning | Refresh to try again. |
| 328 | PDF generation | PDF generation failed | Couldn't generate PDF | Try again. |
| 329 | Status transition failed | Update failed / (dynamic) | Couldn't update status | Try again. |
| 330 | Save follow-up notes | Save failed | Couldn't save follow-up | Try again. |
| 331 | Mark follow-up complete | Update failed | Couldn't update follow-up | Try again. |
| 332 | Save internal notes | Save failed | Couldn't save notes | Try again. |
| 333 | Close warning | Close failed | Couldn't close warning | Try again. |
| 334 | Empty signature | Please provide your signature | (inline) | Add your signature before submitting |
| 335 | Sign API failure | Signing failed / (dynamic) | Couldn't submit signature | Try again. |
| 336 | Illegal transition | Cannot transition from {current} to {next} | Can't change status | This warning can't move from {current} to {next}. |
| 337 | Schedule guards | meeting_date / Manager / HR Witness is required to schedule a write-up | (inline at fields) | (P5) |
| 338 | Finalize guards | meeting_notes are required when finalizing a write-up | (inline) | Add meeting notes before finalizing |
| 339 | Follow-up guards | follow_up_date is required when follow-up is required / follow_up_assigned_to is required | (inline) | Pick a follow-up date and assignee |
| 340 | Recall (non-manager) | Only managers can recall a document | You don't have access | Only managers can recall a warning. |
| 341 | Refusal (non-manager) | Only managers can record a signature refusal | You don't have access | Only managers can record a signature refusal. |
| 342 | Refusal — no reason | refusal_reason is required when recording a signature refusal | (inline) | Add a reason for the refusal |
| 343 | Complete follow-up — no notes | follow_up_notes are required to complete a follow-up | (inline) | Add follow-up notes before completing |
| 344 | Sign — non-CSR | Only CSRs can sign write-ups | You don't have access | Only the agent named on this warning can sign it. |
| 345 | Sign other agent's warning | You can only sign your own write-ups | You don't have access | You can only sign your own warnings. |
| 346 | Sign — wrong status | Write-up is not awaiting signature | Already signed or recalled | This warning isn't waiting for a signature. |
| 347 | Sign — empty signature_data | signature_data is required | (inline) | Add your signature before submitting |
| 348 | Internal notes after close | Internal notes cannot be edited after the warning is closed | Notes are locked | Internal notes can't be edited after a warning is closed. |
| 349 | Follow-up before signed | Follow-up can only be set on a signed write-up | Not signed yet | Follow-up can only be added after the warning is signed. |
| 350 | Follow-up notes wrong state | Follow-up notes can only be saved while a write-up is in follow-up | Not in follow-up | Follow-up notes can only be saved during the follow-up period. |

### 6.12 Write-ups — Search modals

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 351 | QA search failed | Search failed / Could not fetch QA records. | Couldn't search QA records | Try again. |
| 352 | Coaching search failed | Search failed / Could not load coaching sessions. | Couldn't search coaching | Try again. |
| 353 | Discipline history failed | Failed to load discipline history | Couldn't load history | Try again. |
| 354 | Missing csr_id | csr_id is required | (inline / system — usually impossible) | (P14) |

---

## 7. Insights

### 7.1 Source Reports (admin)

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 355 | Frequency invalid | Invalid frequency / Enter a number greater than zero. | (inline) | Enter a number greater than zero |
| 356 | Interval too small | Too frequent / Minimum interval is 5 minutes. | (inline) | Minimum interval is 5 minutes |
| 357 | Bad run-only-hours | run_only_hours must be blank or an hour range like '2-5' (0-23) | (inline) | Use an hour range like 2-5 (0–23), or leave blank |
| 358 | Schedule save failed | Update failed / Try again. | Couldn't update schedule | Try again. |
| 359 | Run-now failed | Failed / Could not start {report_name}. | Couldn't start run | Try again. If this keeps happening, contact support. |
| 360 | List load | Failed to list source reports | Couldn't load source reports | Refresh to try again. |
| 361 | Source report not found | Source report not found | This report no longer exists | It may have been removed. Refresh to see current source reports. |

### 7.2 KPI Management

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 362 | Save description failed | Failed to save description | Couldn't save description | Try again. |
| 363 | Effective From empty | Required | (inline) | Effective From is required |
| 364 | KPI list load | Failed to list KPIs | Couldn't load KPIs | Refresh to try again. |
| 365 | Duplicate code | A KPI with this code already exists | Code already in use | Choose a different KPI code. |
| 366 | KPI not found | KPI not found | KPI no longer exists | Refresh to see current KPIs. |
| 367 | Threshold no date | effective_from is required | (inline) | Effective From is required |
| 368 | Threshold not found | Threshold not found | Threshold no longer exists | Refresh to see current thresholds. |
| 369 | Threshold save (no toast today) | (silent) | Couldn't save threshold | Try again. |
| 370 | Threshold delete (no toast today) | (silent) | Couldn't delete threshold | Try again. |
| 371 | KPI config (live tile) | Failed to load KPI config | Couldn't load KPI tiles | Refresh to try again. |

### 7.3 Page Management

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 372 | Save role access | Failed to save access / {e.message} | Couldn't save access | Try again. |
| 373 | Save dept access | Failed to save department access | Couldn't save access | Try again. |
| 374 | Create override | (e.message) | Couldn't create override | Try again. |
| 375 | Pages list load | Failed to list pages | Couldn't load pages | Refresh to try again. |
| 376 | Override delete (no toast today) | (silent) | Couldn't delete override | Try again. |
| 377 | Insights access check | Authentication required / Unknown role | (handled by route guard) | (P10 / P7) |

### 7.4 Business Calendar

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 378 | Calendar load | Failed to load calendar. Please refresh. | Couldn't load calendar | Refresh to try again. |
| 379 | Year/month required | year and month (1–12) are required | (inline) | Pick a year and month |
| 380 | Bad date param | date must be YYYY-MM-DD | (inline) | Pick a valid date |
| 381 | Bad day_type | day_type must be one of: WORKDAY, WEEKEND, HOLIDAY, CLOSURE, ADJUSTMENT | (inline / select) | Pick a valid day type |
| 382 | Save day (no toast today) | (silent) | Couldn't save calendar day | Try again. |
| 383 | Fill month (no toast today) | (silent) | Couldn't save month defaults | Try again. |

### 7.5 Ingestion / Import

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 384 | Ingestion log load | Failed to load ingestion log | Couldn't load ingestion log | Refresh to try again. |
| 385 | No file uploaded | No file uploaded. Attach an Excel file as "file". | (inline / dropzone) | Choose an Excel file to upload |
| 386 | Bad data_type | Invalid or missing data_type. Must be one of: ... | (inline) | Pick a data type |
| 387 | Upload failed | Import failed / (e.message) | Upload failed | We couldn't import this file. Check the format and try again. |
| 388 | Preview failed | Preview failed | Couldn't preview file | Check the file format and try again. |
| 389 | Import history load | Failed to load import history | Couldn't load import history | Refresh to try again. |
| 390 | Import not found | Import log not found | This import no longer exists | Refresh to see current imports. |
| 391 | Data freshness load | Failed to load data freshness | Couldn't load freshness | Refresh to try again. |

### 7.6 On-Demand Reports

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 392 | Reports list load | Failed to load reports. Please try again. | Couldn't load reports | Refresh to try again. |
| 393 | No period | Filter required / Pick a period. | (inline / toast) | Pick a period to continue |
| 394 | Custom dates missing | Pick a custom start and end date. | (inline) | Pick a start and end date |
| 395 | Start > end | Start date must be on or before end date. | (inline) | Start date must be on or before end date |
| 396 | Download before run | Run the report first / Apply your filters with Run before downloading. | Run the report first | Apply your filters with Run before downloading. |
| 397 | Download failed | Download failed / (server message) | Couldn't download report | Try again. |
| 398 | Run failed | Failed to run the report. Adjust your filters and try again. | Couldn't run report | Adjust your filters and try again. |
| 399 | Report not found | Report not found | Report no longer exists | Refresh to see current reports. |
| 400 | Forbidden role | Access denied for this report | You don't have access | Ask your administrator if you need access to this report. |
| 401 | Custom missing dates | customStart and customEnd are required for custom periods (YYYY-MM-DD). | (inline) | Pick a custom start and end date |
| 402 | Filter options load | Failed to load filter options | Couldn't load filters | Refresh to try again. |

### 7.7 Agent Activity

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 403 | Email activity load | Failed to load email activity. | Couldn't load email activity | Refresh to try again. |
| 404 | Call activity load | Failed to load call activity. | Couldn't load call activity | Refresh to try again. |
| 405 | Tickets/tasks load | Failed to load tickets & tasks. | Couldn't load tickets and tasks | Refresh to try again. |
| 406 | Leads load | Failed to load leads. | Couldn't load leads | Refresh to try again. |
| 407 | Margin load (no UI today) | (silent) | Couldn't load margin | Refresh to try again. |
| 408 | Status check load | Failed to load agent activity status | Couldn't load status | Refresh to try again. |

### 7.8 QC Agents and dashboards

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 409 | Forbidden agent profile | Access denied / You don't have access to that agent's profile. | You don't have access | You don't have access to that agent's profile. |
| 410 | QC query error (default) | Unable to load data. Please try again. | Couldn't load this view | Refresh to try again. |
| 411 | Self-only profile | You can only view your own profile | You don't have access | You can only view your own profile. |
| 412 | Bad userId | Invalid userId | Couldn't load profile | This agent no longer exists. |
| 413 | Category breakdown — missing param | categoryId or category query parameter is required | (filter) | Pick a category |
| 414 | Coaching topic — missing param | topic query parameter is required | (filter) | Pick a topic |
| 415 | Insights navigation | Failed to load insights navigation | Couldn't load navigation | Refresh to try again. |

### 7.9 Raw Data Export

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 416 | Tables list | Failed to fetch tables | Couldn't load tables | Refresh to try again. |
| 417 | Table not found | Table "{tableName}" not found | Table not available | The "{tableName}" table doesn't exist or has been removed. |
| 418 | Schema load | Failed to fetch schema | Couldn't load schema | Refresh to try again. |
| 419 | Query failed | Query failed | Couldn't run query | Adjust your query and try again. |
| 420 | Export failed | Export failed | Couldn't export | Try again. |

### 7.10 Phone System

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 421 | Missing conversation ID | Conversation ID is required | (URL param — not user-facing typically) | (P14) |
| 422 | Recording not found | No recording found for conversation ID: {id} | Recording not available | No recording is available for this conversation. |
| 423 | Audio URL fetch failed | Failed to retrieve audio URL | Couldn't load audio | Try again. |
| 424 | Recording stream failed | Failed to stream recording | Couldn't play recording | Try again. |
| 425 | File unreachable on share | Recording file is unreachable on the PhoneSystem share | Recording is unavailable | We can't reach this recording right now. Try again in a moment. |
| 426 | Transcript not found | No transcript found for conversation ID: {id} | Transcript not available | No transcript is available for this conversation. |
| 427 | Transcript fetch failed | Failed to retrieve transcript | Couldn't load transcript | Try again. |
| 428 | Phone DB health | PhoneSystem database connection failed | Phone system is unavailable | Calls and recordings are temporarily unavailable. We're aware and looking into it. |

### 7.11 Report Builder / Saved Reports (placeholders today)

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 429 | Reports list | Failed to fetch reports | Couldn't load reports | Refresh to try again. |
| 430 | Nav reports | Failed to fetch nav reports | Couldn't load reports | Refresh to try again. |
| 431 | Create | name, layout_config, and audience_scope are required | (inline) | Fill in name, layout, and audience |
| 432 | Create/update/delete/duplicate | Failed to ... | Couldn't save report | Try again. |
| 433 | Bad report id | Invalid report ID | Report no longer exists | Refresh to see current reports. |

### 7.12 Performance Metrics (legacy registry)

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 434 | Metrics list | Failed to fetch metrics | Couldn't load metrics | Refresh to try again. |
| 435 | Create — required fields | code, name, aggregation, and direction are required | (inline) | Fill in code, name, aggregation, and direction |
| 436 | Duplicate code | A metric with that code already exists | Code already in use | Choose a different code. |
| 437 | Threshold required | red_below and yellow_below are required | (inline) | Set both red and yellow thresholds |

### 7.13 Director Departments

| # | Trigger | Current | Proposed Title | Proposed Description |
|---|---|---|---|---|
| 438 | List failure | Internal server error | Couldn't load assignments | Refresh to try again. |
| 439 | Create — missing | Director ID and Department ID are required | (inline) | Pick a director and a department |
| 440 | Bad director | Invalid Director ID or user is not a Director | (inline) | Pick a user with the Director role |
| 441 | Bad department | Invalid Department ID | (inline) | Pick a valid department |
| 442 | Duplicate | This director-department assignment already exists | Already assigned | This director is already assigned to this department. |
| 443 | Bulk bad body | Valid assignments array is required | (inline) | Pick at least one assignment |
| 444 | Delete missing | Assignment not found | Already removed | This assignment no longer exists. Refresh the list. |

---

## 8. Cross-cutting consolidation

These strings are repeated many times across controllers. Replacing them with the proposed canonical messages eliminates the bulk of inconsistency:

| Repeated string | Count | Canonical replacement |
|---|---|---|
| `Internal server error` | ~50+ controller fallbacks (list.controller has 6 alone) | P14 |
| `formId must be a positive integer` | ~25 routes in `ai-reviewer.routes.ts` | (param guard — internal, never reach UI) |
| `id must be a positive integer` | ~8 routes | (internal) |
| `Authentication required` | ~9 controllers + middleware | P10 |
| `Failed to update status` | 2 (Users + Departments) | "Couldn't update {user/department}" |
| `Failed to load data.` | TableErrorState default | "Couldn't load this table" |
| `Try again.` | 3 (Email Templates) | (use "Try again." consistently as description) |
| `Invalid {entity} ID` | many | (internal, never reach UI — replace with 404 P8 message) |

---

## 9. Gaps to flag (errors that today aren't shown to the user at all)

These mutations have no `onError` toast or visible feedback today. The catalog above already proposes messages, but these need wiring:

- KPI threshold save / delete (`InsightsKpiManagementPage`)
- Page management override delete
- Calendar save day / fill month
- Margin page (`AAMarginPage`) — silent on load failure
- Forgot-password page — no error UI for network failures
- Resource toggle (BE 400 swallowed)
- Several ingestion log controls
- 401 handling currently silently redirects with no notice

---

## 10. Recommended next steps (out of scope for this catalog)

Once you've reviewed and signed off on these messages, the natural follow-up work is:

1. **Centralize the messages** in a single TypeScript module (e.g., `frontend/src/lib/errorMessages.ts`) keyed by an enum like `ERR.LOAD_FAILED`, `ERR.SESSION_EXPIRED`, etc., so every component imports the same strings.
2. **Add a global axios → toast handler** (or TanStack Query default `onError`) that maps backend `error.type` / status code to the canonical pattern (P1–P15) automatically. Today every component re-implements this ad hoc.
3. **Migrate (C)-style backend envelopes to (A)** so the frontend can rely on a consistent `error.type` field (already documented in `backend/src/utils/errorHandler.ts`).
4. **Wire correlationId into the toast description** when the response carries one, so support can trace any error a user reports.

These are not part of this review pass — they're listed only to show what the catalog enables.
