/**
 * Seed data for the Contact Call Review Form (v2 AI Pilot).
 *
 * Consumed by `seedContactFormV3.ts`. Everything is plain data — no Prisma,
 * no DB access. Each question carries a stable `slug` so conditions and
 * rubrics can refer to it before the DB id is known.
 *
 * Source of truth for all wording, scoring values, conditional gates, and
 * AI rubrics is the v3 form spec produced during the redesign chat.
 *
 * Notes for editors:
 *   - `yes_value=1, no_value=0` ONLY on the 9 category roll-ups (R1–R9).
 *     Every other YES_NO is zero-valued (analytics + critical-gate only).
 *   - `is_critical=true` triggers the 60% cap on any "no" answer regardless
 *     of yes_value, so 0-pointed compliance items still gate the score.
 *   - Conditions are all `EQUALS YES` (or `EQUALS NO` for outbound greeting),
 *     single-group AND, matching the live form's pattern.
 *   - Question wording is auditor-facing (≤ 255 chars). The AI rubric goes
 *     into `ai_form_question_rubric.rubric_md`, invisible to auditors.
 */

export type SeedQuestionType =
  | 'YES_NO'
  | 'SUB_CATEGORY'
  | 'TEXT';

export interface SeedCondition {
  target_slug: string;
  condition_type?: 'EQUALS' | 'NOT_EQUALS';
  target_value?: string;
}

export interface SeedQuestion {
  slug: string;
  text: string;
  type: SeedQuestionType;
  yes_value?: number;
  no_value?: number;
  is_na_allowed?: boolean;
  is_critical?: boolean;
  conditions?: SeedCondition[];
  rubric_md?: string;
}

export interface SeedCategory {
  name: string;
  weight: number;
  sort: number;
  questions: SeedQuestion[];
}

export const FORM_META = {
  form_name: 'Contact Call Review Form (v2 AI Pilot)',
  interaction_type: 'CALL' as const,
  version: 1,
  is_active: false,
  critical_cap_percent: 60,
  ai_enabled: true,
  ai_submit_as_draft: true,
  ai_sample_review_pct: 10,
  ai_sample_low_score_always: true,
  ai_review_guidance: [
    `- Scoring model: Only one question per category is the roll-up (the one whose RUBRIC opens with "This is a category ROLL-UP"). Roll-ups are the only questions that count toward the score; every other YES/NO is zero-valued and exists for coaching context and as critical-compliance gates that cap the final score at 60 on a NO even though they carry no points themselves.`,
    `- Roll-up rule: Within each category, answer every visible detail first, then derive the roll-up — NO if any detail is NO; YES if all graded details are YES (some may be N/A); N/A if every visible detail is N/A (you couldn't grade any from the evidence available); YES if no details are visible at all because the category's gate questions ruled them out.`,
    `- Work-From-Home category: These questions require audio evidence (background noise, other voices, audio clarity). If your evidence sources don't include audio analysis, answer N/A on every WFH question (not YES) and add a documentation observation at severity "info" noting the category was deferred to human review. When audio analysis becomes available, grade normally per each question text.`,
    `- Customer-intent diversion: If the customer asked for a service call, refund, cancellation, or escalation, grade against THAT process rather than the troubleshooting playbook. Mark troubleshooting steps not_applicable and explain in your narrative which alternate path the agent should have followed (and whether they did).`,
    `- Critical questions: A NO on any critical question caps the final score at 60. The critical list is pre-flagged in the form schema — don't invent new criticals, don't downgrade a critical NO to "minor", and the cap fires regardless of where the rest of the form lands.`,
    `- Inbound call flow: The script for inbound calls runs in three steps and each step is its own scoring line — do NOT conflate them. STEP 1 (graded by 1.2) is the OPENING — three tokens only: brand thank ("thank you for calling Dynamic Media"), agent name ("my name is ____"), and identification ask ("may I please have your account number or your business name"). Do NOT require "how can I help you today" in the opening. STEP 2 (graded by 1.3) is account VERIFICATION — the agent receives at least one identifier before discussing account specifics. STEP 3 (graded by 1.4) is the NEW-vs-EXISTING decision PLUS the correct branch script — on a NEW issue the agent asks "how can I help you today" (or equivalent) to invite the customer to state their need; on an EXISTING issue the agent pulls up the ticket and continues from where it left off rather than re-taking intake. Each scripted moment belongs to exactly one question; grading any moment outside its assigned question is incorrect.`,
    `- Grade for MEANING, not verbatim wording: For every script-compliance question on this form (greeting, verification, hold permission, transfer consent, KB-driven scripts, wrap-up close, brand thank, etc.), grade the agent's wording on whether it conveys the same INTENT and CONTENT as the approved script — not on whether the agent recited the script word-for-word. Paraphrases, natural language variations, and minor word substitutions that preserve the meaning all count as a match. Penalize only when key content is missing, materially drifts from the script's intent, or contradicts the script's purpose. When in doubt, lean toward YES if the customer would reasonably understand the same message.`,
  ].join('\n'),
};

// ── Reusable rubric snippets ────────────────────────────────────────────────

const ROLLUP_RUBRIC = `This is a category ROLL-UP — the only scored question in this category. Answer LAST, after every visible detail in this category.

CRITICAL: IGNORE GATE QUESTIONS when computing this roll-up. A gate question is any question whose rubric begins with "Gate." — they are routing indicators that decide which detail questions are visible, NOT quality criteria themselves. Their YES/NO has zero effect on the roll-up verdict. Example: in "Knowledge & Problem Solving", q4.6 "Did the call require troubleshooting?" is a gate; a NO there means troubleshooting wasn't needed, which is neither good nor bad — it just gates whether 4.7/4.8/4.9 are gradeable. Do NOT let a gate NO drive this roll-up to NO.

Apply these rules in order, considering ONLY non-gate detail questions:
1. If ANY visible non-gate detail is NO, this roll-up is NO.
2. If every visible non-gate detail you graded is YES (some may be N/A), this roll-up is YES.
3. If EVERY visible non-gate detail is N/A (you couldn't grade any of them from the evidence available), this roll-up is N/A — defer the entire category to human review.
4. If no non-gate details are visible at all (the gate questions ruled them all out), this roll-up is YES — nothing applicable to fail.

For evidence_quote: cite the non-gate detail that drove a NO; for YES, "all visible non-gate details verified"; for N/A, "category requires evidence not available in transcript / data sources".`;

const WFH_AUDIO_REQUIRED = `This question grades compliance with work-from-home policy on factors that can only be confirmed from the call audio (background sounds, other voices in the room, audio clarity).

- If your evidence sources do NOT include audio analysis (transcript-only): answer N/A. Set evidence_source to "human-review-required" and evidence_quote to "". Emit ONE \`documentation\` observation at severity "info" stating the WFH item was deferred because audio was not available.
- If your evidence sources DO include audio analysis: grade normally per the question text. NO if any disqualifying signal is present in the audio (household noise, other voices, excessive static/dropout/echo). YES if the audio is clean. Cite the audio observation in evidence_quote.

N/A excludes the question from the score so the agent is neither rewarded nor penalized for something you couldn't evaluate. A human reviewer with audio access will replace your N/A with YES or NO during their pass.`;

// ── Categories ──────────────────────────────────────────────────────────────

export const CATEGORIES: SeedCategory[] = [
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'Initial Greeting / Customer Verification',
    weight: 0.10,
    sort: 0,
    questions: [
      {
        slug: 'R1',
        text: 'Did the agent open the call correctly, with the right greeting and verification for the call direction?',
        type: 'YES_NO',
        yes_value: 1,
        no_value: 0,
        rubric_md: ROLLUP_RUBRIC,
      },
      { slug: '1.0', text: 'Call Direction', type: 'SUB_CATEGORY' },
      {
        slug: '1.1',
        text: 'Was this an inbound call?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        rubric_md: `Factual gate question — does not affect the score directly, but controls which detail questions apply. Answer YES if the interaction header / call metadata shows direction = INBOUND, or the transcript opens with the customer speaking first. Answer NO if header shows OUTBOUND or the transcript opens with the agent dialing/announcing themselves cold. Evidence_source: "interaction header" or the transcript's first turn.`,
      },
      {
        slug: '1.2',
        text: 'Did the agent use the approved inbound greeting (brand thank, agent name, and identification ask)?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        conditions: [{ target_slug: '1.1' }],
        rubric_md: `Grade for MEANING, not verbatim wording. Paraphrases that convey the same intent count as a match — agents are NOT required to recite the script word-for-word.

The approved inbound opening is: "Thank you for calling Dynamic Media; my name is ____. May I please have your account number or your business name?"

YES requires all three tokens in the agent's first speaking turn (typically the first ~10 seconds):
(a) BRAND THANK — "thank you for calling Dynamic Media" (or equivalent brand-thank that names Dynamic Media)
(b) AGENT NAME — "my name is ____" (or any equivalent self-introduction by name)
(c) IDENTIFICATION ASK — the first prompt that gets the customer talking by asking for an identifier ("may I please have your account number or your business name", "can I get your account number", "who am I speaking with on what account", etc.)

Do NOT require an "offer to help" / "how can I help you today" phrase in the opening — per the script, that ask happens LATER (after the new-vs-existing decision in 1.4), not in the opening greeting. Penalizing the opening for missing "how can I help" is incorrect.

Quote the agent's opening turn in evidence_quote. NO only if any of the three tokens above is missing or materially drifts from its intent. Confidence ≥ 0.90 when the transcript is clean; 0.60–0.70 if a token is paraphrased or the transcript is noisy.`,
      },
      {
        slug: '1.3',
        text: 'Did the agent correctly identify the customer\'s account before discussing account details?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        conditions: [{ target_slug: '1.1' }],
        rubric_md: `Grade for MEANING. Verification is satisfied as soon as the agent has enough information to land on the right customer record — the agent does NOT need to echo the identifier back to the customer.

YES requires EITHER of the following BEFORE any account-specific information (balance, invoice, ticket history, equipment, credentials) is discussed:
- **Path (a) — Any single identifier obtained**: the agent received at least ONE identifier from the customer that uniquely maps to an account. Acceptable identifiers include business/customer name, account number, phone number on file, service address, email on file, OR the caller's own name when it matches the ticket contact. Simply RECEIVING the identifier (e.g. customer says "Paradox Brewer" after the agent asks for it) counts — the agent does NOT have to repeat it back.
- **Path (b) — Two-identifier confirmation**: only required when path (a) alone wouldn't uniquely identify the account (e.g. a business name shared by multiple customers, an ambiguous first name, the caller's identity is unclear). In that case the agent must confirm a SECOND identifier from the list above.

NO only if account-specific info was volunteered before ANY identifier was obtained. Quote the verification span and the first identifier received in evidence_quote. Coaching observation; not a critical gate.`,
      },
      {
        slug: '1.4',
        text: 'Did the agent determine whether this was a new or existing issue, AND follow the correct script for that branch?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        conditions: [{ target_slug: '1.1' }],
        rubric_md: `Grade for MEANING, not verbatim wording. Two-part check — BOTH parts must pass for YES.

**Part 1 — Determine new vs existing:**
Agent must explicitly ask OR confirm whether the customer has called about this before / has an open ticket. Acceptable phrasings include "is this regarding a ticket we have open?", "have we spoken about this before?", "is this a new issue or something we've been working on?", "do you have an existing ticket number?", or any paraphrase that establishes the same context. Confirmations also count (e.g. the customer volunteers a ticket number and the agent confirms "okay, so this is the open ticket from Tuesday").

**Part 2 — Follow the correct branch script for whichever was determined:**
- **NEW issue branch**: agent must invite the customer to state their need ("how can I help you today", "what can I do for you", "what's going on", "tell me what you're seeing", or any equivalent natural opener that hands the floor to the customer to describe the problem). Grade for meaning — any wording that clearly invites the customer to describe their need counts.
- **EXISTING issue branch**: agent must reference the existing ticket / prior history before starting work (e.g. pulls up the ticket number, references prior notes, picks up where the last interaction left off) rather than re-asking intake questions the customer has already answered on a prior call.

YES if BOTH parts pass for whichever branch applies. NO if Part 1 was skipped (agent jumped straight into troubleshooting without ever establishing whether this was new or existing), OR if the wrong branch script was followed (e.g. agent re-took full intake on an issue the customer clearly indicated was existing; or agent jumped straight to solutions on a new issue without ever inviting the customer to state their need). Quote the relevant span(s) in evidence_quote and call out which branch applied.`,
      },
      {
        slug: '1.5',
        text: 'Did the agent restate the caller\'s need in their own words before starting support?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        conditions: [{ target_slug: '1.1' }],
        rubric_md: `Grade for MEANING, not verbatim wording. The recap evidence lives in the CALL transcript only — never grade NO because the ticket NOTES don't restate the issue; notes are not where recaps live.

YES requires the agent to paraphrase or summarize the customer's stated problem back to the customer for confirmation BEFORE moving into solutions.

Evidence path (Pass-2 must check in this order):
1. Scan the trace's \`extracted_claims[]\` for any entry with \`claim_type: "agent_statement"\` whose \`evidence_quote\` matches a recap shape (see list below). If found → YES, quote it.
2. Scan the trace's \`timeline[]\` for any entry whose \`kb_step\` is \`"Problem restatement / confirmation"\` (or whose \`action\` describes a recap / confirmation). If found → YES, quote the action line.
3. Only if BOTH (1) and (2) are empty for this source → NO. In NO, the \`evidence_quote\` must reference the first AGENT turn in the timeline AFTER the customer's symptom statement, so the auditor can see the gap.

Recap shapes that ALL qualify as YES (not exhaustive):
- "so what I'm hearing is..."
- "just to confirm, you're saying..."
- "okay, so the issue is..."
- "Gotcha. Okay, so just wanna confirm, it looks like ... is that correct?" — the recap-and-confirm pattern
- "let me make sure I have this right — you're trying to ..."
- Any restatement that ends in an explicit confirmation ask ("right?", "correct?", "is that what's happening?")`,
      },
      {
        slug: '1.6',
        text: '(Outbound) Did the agent identify themselves and Dynamic Media in the first 15 seconds?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        conditions: [{ target_slug: '1.1', condition_type: 'EQUALS', target_value: 'NO' }],
        rubric_md: `Outbound-only. YES requires the agent's name AND "Dynamic Media" in the agent's first speaking turn. Quote that turn. NO if either token is missing.`,
      },
      {
        slug: '1.7',
        text: '(Outbound) Did the agent state the reason for the call before discussing account details?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        conditions: [{ target_slug: '1.1', condition_type: 'EQUALS', target_value: 'NO' }],
        rubric_md: `Outbound-only. YES requires a clear purpose statement ("I'm calling about your invoice", "I'm following up on your service request") BEFORE any account-specific information is exchanged. Quote the purpose statement.`,
      },
      {
        slug: '1.8',
        text: '(Outbound) Did the agent verify the customer\'s identity before discussing account details?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        conditions: [{ target_slug: '1.1', condition_type: 'EQUALS', target_value: 'NO' }],
        rubric_md: `Outbound-only. YES requires explicit verification of TWO identifiers (name + one of: account number, address, phone, email on file) BEFORE any account info is shared. Quote the verification exchange. NO if account specifics are shared without verification. Coaching observation; not a critical gate.`,
      },
      { slug: '1.F', text: 'Feedback — Greeting / Verification', type: 'TEXT' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'Contact Management',
    weight: 0.10,
    sort: 1,
    questions: [
      {
        slug: 'R2',
        text: 'Were all required contact-management actions handled correctly?',
        type: 'YES_NO',
        yes_value: 1,
        no_value: 0,
        is_na_allowed: true,
        rubric_md: `Decision order — pick the FIRST that fits:

1. N/A — the call contained no contact-management opportunity at all.
   That means ALL FOUR gates are NO:
     - 2.1 (opportunity to confirm billing contact) = NO
     - 2.4 (customer referenced a person not in CRM) = NO
     - 2.7 (customer indicated someone left the org) = NO
     - 2.10 (call indicated a contact owner/role change is needed) = NO
   Cite "no opportunity on this call" plus the four gate evaluations
   in evidence.

2. YES — at least one of the four gates fired AND every required
   downstream action for that gate was completed correctly in CRM
   (2.2, 2.5, 2.8, 2.11 as applicable).

3. NO — at least one gate fired AND any required downstream action
   was missed or done incorrectly.

Evidence: name the gate that fired and quote the matching action
question's transcript / ticket evidence (or absence of it). If N/A,
list the four gate evaluations.

Never grade this question from rollup math alone — anchor on the
gate evaluations the trace already produced.`,
      },
      { slug: '2.0', text: 'Billing Contact', type: 'SUB_CATEGORY' },
      {
        slug: '2.1',
        text: 'Did the call provide an opportunity to confirm the current billing contact?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        rubric_md: `Gate. YES if billing, invoicing, payment, or who-receives-invoices was discussed in the transcript or referenced in the ticket. NO otherwise.`,
      },
      {
        slug: '2.2',
        text: 'Did the agent confirm the billing contact\'s name with the customer?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        conditions: [{ target_slug: '2.1' }],
        rubric_md: `YES requires the agent to verbally confirm the billing contact ("just to confirm, invoices still go to [name]?"). Quote the confirmation. NO if billing was discussed but no confirmation occurred.`,
      },
      { slug: '2.3', text: 'Contact Addition', type: 'SUB_CATEGORY' },
      {
        slug: '2.4',
        text: 'Did the customer reference a person not currently in the CRM?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        rubric_md: `Gate. Compare names mentioned in the transcript against the customer's existing contacts in CRM. YES if a referenced person is NOT in CRM. NO if no new person was referenced or all referenced people exist in CRM.`,
      },
      {
        slug: '2.5',
        text: 'Did the agent add the new contact to the CRM?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        conditions: [{ target_slug: '2.4' }],
        rubric_md: `YES requires evidence of a new contact record created on this customer during the call window — check the CRM contact list for a contact created/modified during the call. NO if 2.4 was YES but no contact was added.`,
      },
      { slug: '2.6', text: 'Contact Removal', type: 'SUB_CATEGORY' },
      {
        slug: '2.7',
        text: 'Did the customer indicate someone has left the organization?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        rubric_md: `Gate. YES if the transcript contains phrases like "no longer with us", "left the company", "they're not here anymore", or equivalent. NO otherwise.`,
      },
      {
        slug: '2.8',
        text: 'Did the agent set the appropriate contact(s) inactive in the CRM?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        conditions: [{ target_slug: '2.7' }],
        rubric_md: `YES requires a CRM contact's \`active\` status to flip to false during the call window for the person the customer indicated has left. NO if 2.7 was YES but no contact was deactivated.`,
      },
      { slug: '2.9', text: 'Contact Assignment', type: 'SUB_CATEGORY' },
      {
        slug: '2.10',
        text: 'Did the call indicate a contact owner/role change is needed?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        rubric_md: `Gate. YES if the transcript mentions a role/responsibility change ("she's the new GM", "I handle ordering now", "John is taking over for Mary").`,
      },
      {
        slug: '2.11',
        text: 'Did the agent assign the contact to the correct user/role?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        conditions: [{ target_slug: '2.10' }],
        rubric_md: `YES if the CRM contact's \`assigned_to\` or role field was updated during the call window to match the customer's stated assignment. NO if 2.10 was YES but no update was made.`,
      },
      { slug: '2.F', text: 'Feedback — Contact Management', type: 'TEXT' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'CRM / Knowledge Base',
    weight: 0.10,
    sort: 2,
    questions: [
      {
        slug: 'R3',
        text: 'Did the agent use the CRM and Knowledge Base correctly throughout the call?',
        type: 'YES_NO',
        yes_value: 1,
        no_value: 0,
        is_critical: true,
        rubric_md: `${ROLLUP_RUBRIC}\n\nCRITICAL — a NO on this roll-up caps the final score at 60. CRM/KB usage is non-negotiable.`,
      },
      { slug: '3.0', text: 'CRM', type: 'SUB_CATEGORY' },
      {
        slug: '3.1',
        text: 'Were the agent\'s CRM updates all on the correct customer\'s record?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        rubric_md: `YES if every note, ticket, task, and field update tied to this call is on a record belonging to the customer the agent was speaking to. NO if any update lands on a different customer's record (cross-customer activity). Cite the misrouted record id if NO.`,
      },
      {
        slug: '3.2',
        text: 'Were CRM updates completed during the call or within 5 minutes of call end?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        rubric_md: `YES if the latest note/ticket update timestamp on this case is ≤ call_end_time + 5 minutes. NO otherwise. Quote the timestamps (note timestamp and call end time) in evidence_quote.`,
      },
      { slug: '3.3', text: 'Knowledge Base', type: 'SUB_CATEGORY' },
      {
        slug: '3.4',
        text: 'Did the agent follow the KB article applicable to this issue?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        is_na_allowed: true,
        rubric_md: `Apply in order — stop at the FIRST matching path:
1. N/A when no KB page was actually loaded into your prompt for this case. Check the \`KB PAGES LOADED FOR THIS CASE\` block at the top of the user prompt: if it shows \`(none)\` — OR no entry matches the customer's stated issue — answer N/A and emit a \`documentation\` observation with kind=\`documentation\`, severity=\`info\`, body naming the missing topic (e.g. "kb_gap: Soundtrack Player App initial setup"). Do NOT substitute ticket notes, re-open commentary, supervisor edits, or your own training knowledge for the KB. If you can't see a KB page, you can't grade KB-following.
2. N/A when a KB page IS loaded but no KB article covers the customer's stated topic on this case (rare — usually the loaded page IS the right one). Same documentation observation as above.
3. YES when the agent's steps in transcript/notes match the documented steps in the loaded KB / playbook page, applying the Resolution-Stop rule (don't penalize stopping after the issue resolved). The agent does not have to follow every step verbatim — meaningful coverage is enough.
4. NO when the agent skipped foundational steps in the loaded KB page or contradicted its guidance.

Cite the loaded KB page name in \`evidence_source\` (e.g. "Soundtrack Player App Setup KB page") so the human reviewer can verify the comparison.`,
      },
      {
        slug: '3.5',
        text: 'Did the agent follow the KB-required script lines for the playbook they were working through (troubleshooting / task / collections scripts)?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        is_na_allowed: true,
        rubric_md: `Agents are NOT required to recite scripts verbatim — grade for MEANING. Paraphrases and natural variations that preserve intent and content count as YES.

SCOPE — this question covers ONLY:
- KB-driven script lines that the assigned playbook explicitly requires the agent to deliver to the customer (troubleshooting playbook scripts, task scripts, collections scripts, and similar process scripts called out in the relevant KB page).

Do NOT grade these here — they have their own questions and are strict transcript-only:
- Greeting / opening (covered by 1.2)
- Account verification (covered by 1.3)
- Hold offers (covered by 5.2)
- Transfer hand-offs (covered by 5.9 / 5.11)
- Wrap-up / brand thank (covered by 6.1–6.4)

EVIDENCE WATERFALL (specific to this question only — does not apply to any other script-compliance question on this form):
1. Transcript first. If the required script line appears in the call transcript (verbatim or in meaning), grade YES and quote the transcript span.
2. If the transcript does NOT contain the line, fall back to ticket/task notes. If the notes credibly demonstrate the underlying KB process was followed (e.g. note states the action the script was supposed to introduce), grade YES with \`evidence_source\` set to the note timestamp/author. Be conservative — a generic note like "advised customer" is not enough; the note must reference the specific KB process step the script line belongs to.
3. If neither transcript nor notes support it:
   - If the playbook for this issue lists steps but no required customer-facing script lines, answer N/A and add a brief \`documentation\` observation: "no required script lines in playbook".
   - If a script line was clearly required (the playbook explicitly calls it out) and there is no supporting evidence in transcript or notes, answer NO and quote the missing-script moment.

Never grade NO purely from absence of evidence on this question — absence with no playbook requirement is N/A, not NO.`,
      },
      { slug: '3.F', text: 'Feedback — CRM / Knowledge Base', type: 'TEXT' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'Knowledge & Problem Solving',
    weight: 0.15,
    sort: 3,
    questions: [
      {
        slug: 'R4',
        text: 'Did the agent demonstrate accurate knowledge and effective problem-solving for the customer\'s need?',
        type: 'YES_NO',
        yes_value: 1,
        no_value: 0,
        rubric_md: ROLLUP_RUBRIC,
      },
      { slug: '4.0', text: 'Product / Service Knowledge', type: 'SUB_CATEGORY' },
      {
        slug: '4.1',
        text: 'Did the call involve explanation of a product or service feature?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        rubric_md: `Gate. YES if the customer asked "how does X work", "what does X do", or the agent volunteered a product/service explanation.`,
      },
      {
        slug: '4.2',
        text: 'Were the agent\'s product/service descriptions factually consistent with documentation?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        conditions: [{ target_slug: '4.1' }],
        rubric_md: `Cross-check every factual claim the agent made about a feature/function against the KB or product documentation. YES if all claims are supported. NO if ANY claim contradicts documented behavior. Quote the inaccurate claim and cite the contradicting KB line in evidence_quote.`,
      },
      {
        slug: '4.3',
        text: 'Did the agent define or avoid technical jargon?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        conditions: [{ target_slug: '4.1' }],
        rubric_md: `YES if every acronym or technical term the agent used was either (a) introduced by the customer first, or (b) defined inline before being used again. NO if any acronym or jargon was used unexplained when the customer hadn't used it. Quote the unexplained term if NO.`,
      },
      {
        slug: '4.4',
        text: 'Were all of the customer\'s stated questions answered before the call ended?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        rubric_md: `Walk the transcript. List each customer question. YES if every question received a direct answer before call close. NO if any open question was left unanswered. Quote the unanswered question if NO.`,
      },
      { slug: '4.5', text: 'Problem Solving', type: 'SUB_CATEGORY' },
      {
        slug: '4.6',
        text: 'Did the call require troubleshooting?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        rubric_md: `Gate. YES if the customer reported a problem requiring diagnostic steps. NO for pure information requests, status checks, or billing-only calls.`,
      },
      {
        slug: '4.7',
        text: 'Did the agent ask clarifying questions before proposing a solution?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        is_na_allowed: true,
        conditions: [{ target_slug: '4.6' }],
        rubric_md: `Apply in order — stop at the FIRST matching path:
1. N/A when 4.6 ("Did the call require troubleshooting?") is NO. No troubleshooting = no diagnostic exchange to grade. Pure information requests, status checks, password resets, and billing-only calls all fall here. (This rule also fires deterministically post-grade via the NA-gate guard, but state it in your reasoning so the narrative is consistent.)
2. N/A when the customer stated a specific actionable request and the standard playbook IS to fulfill it directly (e.g. "I need the remote code", "reset my password", "process my refund", "where do I download the app"). Diagnostic questions here would be friction, not value. Quote the customer's direct request in evidence_quote.
3. YES when the call required diagnostic troubleshooting AND the agent asked at least one diagnostic question between hearing the symptom and proposing a fix. Quote the question in evidence_quote.
4. NO only when the call required diagnostic troubleshooting, the symptom was ambiguous (multiple possible causes), AND the agent jumped to a fix with zero diagnostic exchange.

Important guardrail: do NOT fault the agent for not asking about a configuration the customer never mentioned. Diagnostic faults require the customer to have surfaced the relevant signal within the call itself. If the customer didn't say "I'm using one iPad for both player and remote" then the agent had no diagnostic prompt to follow up on — that's still a YES (or N/A under rule 2 if the request was direct).`,
      },
      {
        slug: '4.8',
        text: 'Did the agent own the problem and drive to a resolution or clear next step?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        conditions: [{ target_slug: '4.6' }],
        rubric_md: `YES if the agent either (a) resolved the issue on the call, or (b) created a specific ticket/task with an owner and committed to a follow-up. NO if the agent told the customer "you'll need to contact X" without a warm handoff, or ended the call with the customer unsure who owns the next step. Quote the closing exchange.`,
      },
      {
        slug: '4.9',
        text: 'Did the agent give a specific timeframe for any next action?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        is_na_allowed: true,
        conditions: [{ target_slug: '4.6' }],
        rubric_md: `YES requires a concrete time anchor ("by Tuesday", "within 24 hours", "by end of business today"). NO for vague commitments ("soon", "I'll get back to you", "as soon as I can"). N/A if the issue was fully resolved on the call with no next action pending.`,
      },
      { slug: '4.F', text: 'Feedback — Knowledge & Problem Solving', type: 'TEXT' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'Call Transfer / Hold Procedures',
    weight: 0.05,
    sort: 4,
    questions: [
      {
        slug: 'R5',
        text: 'Were all hold and transfer procedures followed correctly?',
        type: 'YES_NO',
        yes_value: 1,
        no_value: 0,
        is_na_allowed: true,
        rubric_md: `Decision order — pick the FIRST that fits:

1. N/A — BOTH opportunity gates are NO:
     - 5.1 (agent placed customer on hold) = NO
     - 5.7 (call transfer took place) = NO
   No hold and no transfer means no procedure to evaluate. Cite both
   gate evaluations in evidence.

2. YES — at least one branch was exercised AND every procedure for
   THAT branch was followed correctly:
     - Hold branch (when 5.1 = YES): permission asked (5.2), time
       estimate given (5.3), thanked on return (5.5).
     - Transfer branch (when 5.7 = YES): necessary (5.8), reason
       explained (5.9), destination contact info given (5.10),
       consent obtained (5.11), routed to correct department (5.12).
   If only one branch was exercised, the other branch is implicitly
   satisfied — only judge the branch that fired.

3. NO — at least one branch was exercised AND any procedure for that
   branch was missed.

Evidence: cite the gate evaluation for each branch, then the
specific procedure quote (or absence) that drove the YES/NO.`,
      },
      { slug: '5.0', text: 'Hold', type: 'SUB_CATEGORY' },
      {
        slug: '5.1',
        text: 'Did the agent place the customer on hold at any point?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        rubric_md: `Gate. YES if the transcript contains "place you on hold", "put you on hold", "hold on a moment", or a "thanks for holding" / "thanks for your patience" return-to-line span. NO otherwise.`,
      },
      {
        slug: '5.2',
        text: 'Did the agent ask permission before placing the customer on hold?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        conditions: [{ target_slug: '5.1' }],
        rubric_md: `YES requires an explicit ask BEFORE each hold event: "May I place you on hold", "Do you mind if I put you on hold", "I'm going to need to put you on hold, is that okay" with a customer affirmation. NO if any hold occurred without a permission ask. "Hang on" or "one second" are NOT permission. Quote the permission exchange. Coaching observation; not a critical gate.`,
      },
      {
        slug: '5.3',
        text: 'Did the agent provide an estimated hold time before the hold?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        conditions: [{ target_slug: '5.1' }],
        rubric_md: `YES requires a numeric or bounded time estimate before the hold ("about a minute", "two minutes", "no more than five"). NO if no estimate was given. Quote the estimate.`,
      },
      {
        slug: '5.5',
        text: 'Did the agent thank the customer for waiting when returning from hold?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        conditions: [{ target_slug: '5.1' }],
        rubric_md: `YES if the first agent turn after each hold contains "thanks for waiting", "thanks for your patience", "appreciate you holding", or equivalent. NO otherwise. Quote the return-to-line phrase.`,
      },
      { slug: '5.6', text: 'Transfer', type: 'SUB_CATEGORY' },
      {
        slug: '5.7',
        text: 'Did a call transfer take place?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        rubric_md: `Gate. YES if the transcript ends with an agent handoff ("I'm transferring you to…"), the interaction header shows a transfer event, or the call ends with a different agent picking up.`,
      },
      {
        slug: '5.8',
        text: 'Was the transfer necessary?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        conditions: [{ target_slug: '5.7' }],
        rubric_md: `YES if the destination department/team is the documented owner of the customer's stated issue. NO if the issue could and should have been handled by this agent per the KB ownership rules. Quote the topic and name the destination in evidence_quote.`,
      },
      {
        slug: '5.9',
        text: 'Did the agent explain the reason for the transfer?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        conditions: [{ target_slug: '5.7' }],
        rubric_md: `YES requires the agent to state WHY they're transferring ("I'm transferring you to billing because they handle invoice questions"). NO if the agent only said "transferring you now" with no reason. Quote the explanation.`,
      },
      {
        slug: '5.10',
        text: 'Did the agent provide destination contact info in case of disconnect?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        conditions: [{ target_slug: '5.7' }],
        rubric_md: `YES if the agent gave the destination's direct number, department line, or extension before transferring. Quote the contact info given. NO otherwise.`,
      },
      {
        slug: '5.11',
        text: 'Did the agent confirm the customer\'s consent before transferring?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        conditions: [{ target_slug: '5.7' }],
        rubric_md: `YES requires explicit consent confirmation BEFORE the transfer ("is that okay?", "are you alright with that?", "does that work for you?") with a customer affirmative. NO if the transfer happened without confirmation. Quote the consent exchange. Coaching observation; not a critical gate.`,
      },
      {
        slug: '5.12',
        text: 'Was the call transferred to the correct department?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        conditions: [{ target_slug: '5.7' }],
        rubric_md: `YES if the destination matches what the KB or departmental ownership rules say should handle the issue. NO if the destination is a department that will need to re-transfer.`,
      },
      { slug: '5.F', text: 'Feedback — Transfer / Hold', type: 'TEXT' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'Wrap-Up Process',
    weight: 0.10,
    sort: 5,
    questions: [
      {
        slug: 'R6',
        text: 'Did the agent complete the wrap-up correctly?',
        type: 'YES_NO',
        yes_value: 1,
        no_value: 0,
        rubric_md: ROLLUP_RUBRIC,
      },
      {
        slug: '6.1',
        text: 'Did the agent recap the actions taken on the call before closing?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        rubric_md: `YES if the last ~60 seconds of transcript contains an agent summary ("so we did X, Y, and Z today", "to recap…"). Quote the recap. NO if the call ended without an action summary.`,
      },
      {
        slug: '6.2',
        text: 'Did the agent state any next steps with owner and timing?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        is_na_allowed: true,
        rubric_md: `YES if the agent stated WHO owns the next action and WHEN ("I'll follow up by Friday", "the tech will call you within 24 hours"). NO if next steps were vague or unspecified. N/A if the issue was fully resolved on the call with nothing pending. Quote the commitment.`,
      },
      {
        slug: '6.3',
        text: 'Did the agent ask whether the customer needed any additional assistance?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        rubric_md: `YES if the agent explicitly asked ("is there anything else I can help you with?", "anything else today?"). Quote it. NO if the agent moved straight to closing.`,
      },
      {
        slug: '6.4',
        text: 'Did the agent thank the customer for choosing Dynamic Media?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        rubric_md: `YES if the agent's closing turn(s) contain a Dynamic Media-anchored brand thank — ANY of these qualify:
- "thank you for choosing Dynamic Media"
- "thanks for being a Dynamic Media customer"
- "thank you for calling Dynamic Media"
- "appreciate you choosing us at Dynamic Media"
- "thanks for choosing Dynamic Media for your business"
- Or any equivalent close that explicitly names Dynamic Media in a thank/appreciation context.

The key requirement is that the company name "Dynamic Media" must be paired with a thank/appreciation word. The exact phrasing can vary.

NO if the agent closed with a generic "thank you" / "thanks" / "have a good day" alone (no Dynamic Media reference), OR if no closing thank occurred at all. Quote the closing line in evidence_quote with its timestamp.`,
      },
      { slug: '6.F', text: 'Feedback — Wrap-Up', type: 'TEXT' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'Professionalism / Rapport',
    weight: 0.15,
    sort: 6,
    questions: [
      {
        slug: 'R7',
        text: 'Did the agent maintain professionalism and build rapport throughout the call?',
        type: 'YES_NO',
        yes_value: 1,
        no_value: 0,
        rubric_md: ROLLUP_RUBRIC,
      },
      { slug: '7.0', text: 'Professionalism', type: 'SUB_CATEGORY' },
      {
        slug: '7.1',
        text: 'Did the agent let the customer finish speaking before responding?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        rubric_md: `YES if the transcript shows no agent interruptions during customer turns. NO if there are clear interruption patterns — agent speech overlapping mid-customer-sentence, or the agent restarting the customer's topic before the customer finished. Quote one interruption if NO. Confidence 0.50–0.70 since transcript quality on overlap varies.`,
      },
      {
        slug: '7.2',
        text: 'Did the agent speak with confidence, without excessive hedging?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        rubric_md: `NO requires evidence of substantive hedging on factual questions: "I think maybe", "I'm not sure but", "I guess", "I hope so", "probably" when answering substantive customer questions. YES if hedging is absent or limited to genuinely uncertain situations the agent acknowledged ("let me check that for you" is acceptable). Quote a hedging instance if NO.`,
      },
      {
        slug: '7.3',
        text: 'Did the agent avoid jargon, slang, or filler the customer wouldn\'t understand?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        rubric_md: `YES if the agent's vocabulary stayed customer-appropriate. NO if (a) unexplained technical jargon was used, (b) inappropriate slang appeared, or (c) excessive filler ("like", "you know", "um", "uh") materially impeded clarity. Quote one instance if NO.`,
      },
      {
        slug: '7.4',
        text: 'If the customer expressed frustration, did the agent respond with empathy?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        is_na_allowed: true,
        rubric_md: `First detect customer-frustration signals in the transcript: "this is ridiculous", "I've been waiting", "I'm furious", emphatic complaints, repeated exasperation. If present, YES requires the agent to acknowledge with explicit empathy phrasing ("I understand", "I can see why that's frustrating", "I'm sorry you're dealing with this") within the next two agent turns. NO if the customer expressed frustration but the agent ignored it, argued, or responded defensively. Quote both the customer frustration and the agent response. N/A if no frustration signals appeared.`,
      },
      {
        slug: '7.5',
        text: 'Was the agent\'s grammar and word choice professional?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        rubric_md: `YES if the agent's sentences are grammatically complete and free of profanity, inappropriate slang, or aggressively casual language. NO for any profanity, off-color remark, or unprofessional language. Quote the issue if NO.`,
      },
      { slug: '7.6', text: 'Rapport', type: 'SUB_CATEGORY' },
      {
        slug: '7.7',
        text: 'Did the agent use the customer\'s first name at least once after verification?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        rubric_md: `YES if the agent addresses the customer by their first name at least once AFTER verification.

How to identify the customer's first name:
- The customer's first name is the name the CUSTOMER stated when asked their name during verification. Look for the timeline entry "Customer (FIRSTNAME LASTNAME)" or the customer's literal "this is FIRSTNAME" / "my name is FIRSTNAME" turn.
- If the call references multiple proper names (e.g. a third party being added to the account, a colleague being named, a billing contact), use ONLY the verified customer's first name — those other names do not count as the agent using the customer's first name.

How to match the use:
- Match the exact first-name string anywhere from verification onward, in any agent turn.
- The use can be direct address ("Ben, I'll help with that"), conversational ("alright Ben, let me check"), or sentence-internal ("so Ben, you're looking to...").
- ONE qualifying use is sufficient for YES.

NO only if the agent never used the customer's first name after verification (only "sir/ma'am" or no name reference). Quote the agent turn that contains the name use in evidence_quote, with its timestamp.`,
      },
      {
        slug: '7.10',
        text: 'Did the agent use verbal acknowledgments while the customer was speaking?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        rubric_md: `YES if the agent demonstrates active listening via ANY of:
1. Explicit backchannels in agent turns ("okay", "I see", "got it", "mm-hmm", "right", "sure", "gotcha", "yeah", "uh-huh") — these may appear during or immediately after customer turns.
2. Summarizing paraphrases — the agent restates the customer's stated issue or request in their own words ("so what you're saying is...", "let me make sure I understand — you want to...", "okay so basically you're looking to...").
3. Empathetic confirmations — explicit acknowledgments of the customer's situation ("that makes sense", "absolutely", "of course", "I understand", "I can help with that").

Important fidelity note: Webex / phone-system transcription often STRIPS short backchannel tokens (mm-hmm, uh-huh) because they fall below the speech-detection threshold. ACCEPT paraphrases and empathetic confirmations as equivalent evidence — they prove the agent was actively listening even when the literal backchannels didn't make it into the transcript.

NO only if the agent's turns are uniformly transactional with NO acknowledgment markers, NO paraphrasing of the customer's request, and NO empathetic confirmations anywhere in the call. Quote one qualifying agent turn in evidence_quote.`,
      },
      {
        slug: '7.11',
        text: 'Were the agent\'s responses specific to this customer\'s situation?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        rubric_md: `YES if agent responses reference customer-specific details (name, their company, their stated issue's specifics, their account/equipment). NO if responses are interchangeable with any other call — generic phrasing that doesn't reflect this customer's situation. Quote one specific reference if YES, or one generic-only span if NO.`,
      },
      {
        slug: '7.12',
        text: 'Did the agent use positive phrasing rather than negative?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        rubric_md: `YES if the agent uses "I'd be happy to help with that", "what I can do is…", "let me see how I can help" rather than "I can't do that", "that's not possible", "we don't do that" — except when a direct negative is necessary, in which case it should be paired with an alternative. Quote a positive or a bare-negative span.`,
      },
      { slug: '7.F', text: 'Feedback — Professionalism / Rapport', type: 'TEXT' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'Ticket / Task Documentation',
    weight: 0.20,
    sort: 7,
    questions: [
      {
        slug: 'R8',
        text: 'Was the interaction documented completely and accurately in the proper system(s)?',
        type: 'YES_NO',
        yes_value: 1,
        no_value: 0,
        is_critical: true,
        rubric_md: `${ROLLUP_RUBRIC}\n\nCRITICAL — a NO on this roll-up caps the final score at 60. Documentation is the operational record that enables downstream work.`,
      },
      { slug: '8.0', text: 'General', type: 'SUB_CATEGORY' },
      {
        slug: '8.1',
        text: 'Was the interaction documented at all (Task and/or Ticket exists tied to this call)?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        rubric_md: `YES if at least one CRM Task or Ticket record exists linked to this call_id / call window for this customer. NO if no record exists. Cite the record id and creation timestamp in evidence_quote. (The R8 roll-up is the critical gate for documentation — this detail feeds it.)`,
      },
      {
        slug: '8.2',
        text: 'Was the documentation placed in the correct area (Task vs Ticket per policy)?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        conditions: [{ target_slug: '8.1' }],
        rubric_md: `Refer to the "Documentation Policy" KB page for Task vs Ticket routing rules. YES if the record type matches what the policy says for this topic. NO otherwise. Cite the policy rule and the record type chosen.`,
      },
      { slug: '8.3', text: 'Task Documentation', type: 'SUB_CATEGORY' },
      {
        slug: '8.4',
        text: 'Was the interaction documented as a Task?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        rubric_md: `Gate. YES if a Task record was created on this customer during the call window.`,
      },
      {
        slug: '8.5',
        text: 'Were the Task administrative fields set correctly (assignment, status, next-contact-date per policy)?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        conditions: [{ target_slug: '8.4' }],
        rubric_md: `Single combined check. YES requires ALL of: (a) \`assigned_to\` matches the topic owner per policy, (b) \`status\` reflects the actual call outcome (Open / In Progress / Closed), (c) \`next_contact_date\` set when policy requires (treat as satisfied when policy doesn't require). NO if any one field is wrong. State which field(s) failed in evidence_quote.`,
      },
      {
        slug: '8.6',
        text: 'Were the Task notes detailed enough that another agent could pick up the work?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        conditions: [{ target_slug: '8.4' }],
        rubric_md: `YES requires notes that contain: (a) customer's stated issue in customer's words, (b) actions taken on this call, (c) outcome or current state. NO if notes are <100 chars OR contain only status keywords without action verbs OR consist of "talked to customer, will follow up"-type non-content. Quote the notes.`,
      },
      { slug: '8.7', text: 'Ticket Documentation', type: 'SUB_CATEGORY' },
      {
        slug: '8.8',
        text: 'Was the interaction documented as a Ticket?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        rubric_md: `Gate. YES if a Ticket record was created on this customer during the call window.`,
      },
      {
        slug: '8.9',
        text: 'Was the correct Site selected on the ticket?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        conditions: [{ target_slug: '8.8' }],
        rubric_md: `YES if the customer-referenced location matches the \`Site\` line OR any entry in the \`Sites (all linked)\` line of the ticket header. Multi-site tickets (one ticket spanning every store on an account) are normal — when the header shows multiple linked sites, the customer only needs to match ONE of them to grade YES. The header renders as \`Site: <Name> (<City>, <State>) [id <SiteID>]\` plus an optional \`Sites (all linked): <Name> - <Address>, <City> <ST> <Zip> [SiteID N]; …\` line for multi-site tickets. NO only if the customer-stated location appears nowhere in the linked sites, OR if both site lines are blank when the customer clearly referenced a specific site. Cite the customer-stated location and quote the matching Site line in evidence_quote.`,
      },
      {
        slug: '8.10',
        text: 'Was the correct Contact set on the ticket?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        conditions: [{ target_slug: '8.8' }],
        rubric_md: `YES if the \`Contact\` line in the ticket header matches the caller per their identification in the call. The header value renders as \`<First> <Last> <Email> [id <ContactID>]\`. NO if mismatched, or if the Contact line is blank when the caller clearly identified themselves. Quote the caller's name (and email if mentioned) and the header's Contact value in evidence_quote.`,
      },
      {
        slug: '8.11',
        text: 'Did the ticket Description clearly capture the customer\'s stated issue?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        conditions: [{ target_slug: '8.8' }],
        rubric_md: `YES if the Description, in the customer's own words after intake, makes the chosen classification self-evident. NO if Description is vague ("device not working", "customer needs help") or doesn't justify the classification. Quote the Description.`,
      },
      {
        slug: '8.12',
        text: 'Were the Classification and Subclassification set accurately?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        conditions: [{ target_slug: '8.8' }],
        rubric_md: `YES if \`classification\` + \`subclassification\` map to the topic per the documented taxonomy. Cross-check against KB. NO if the classification doesn't fit the issue described in the transcript. State the actual issue and the (mismatched) classification.`,
      },
      {
        slug: '8.13',
        text: 'Were the Ticket administrative fields set correctly (assignment, status, next-contact-date per policy)?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        conditions: [{ target_slug: '8.8' }],
        rubric_md: `Single combined check on the Ticket administrative fields.

**Pre-condition — closed-on-call escape:** If \`Status\` = Closed AND the call/notes show the issue was resolved on this interaction (customer confirmed working, no follow-up promised), the next-contact-date condition is automatically considered N/A and MUST be dropped from this grade. In that case, grade YES iff BOTH (a) \`Assigned To\` matches the topic owner per policy AND (b) \`Status\` = Closed. Do NOT mark NO because a next-contact-date is missing on a closed-on-call ticket — that's expected.

**Otherwise** (ticket still open / follow-up promised / customer waiting on us), YES requires ALL of:
(a) \`Assigned To\` in the ticket header matches the topic owner per policy,
(b) \`Status\` in the ticket header matches the actual call outcome (Open / In Progress / Closed / etc.),
(c) Next-contact-date is captured per policy. NOTE: next-contact-date is NOT a column on the ticket header — CSR policy records it inside the body of each ticket note. Scan the most recent ticket notes for a next-contact-date entry (commonly phrased as "Next contact date:", "Next step is to follow up <date>", or a near-future date called out in the closing line of a note).

NO if any required field above is wrong. State which field(s) failed in \`evidence_quote\` and quote the relevant header line or note span.`,
      },
      {
        slug: '8.14',
        text: 'Were the Ticket notes detailed enough that another agent could pick up the work?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        conditions: [{ target_slug: '8.8' }],
        rubric_md: `Same bar as 8.6 but for ticket notes. YES requires customer's issue in customer's words, actions taken on the call, and outcome/current state. Quote the notes.`,
      },
      {
        slug: '8.15',
        text: 'If the ticket was closed on this call, was a Resolution captured?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        is_na_allowed: true,
        conditions: [{ target_slug: '8.8' }],
        rubric_md: `If \`ticket.status\` is closed, YES requires a Resolution field that describes WHAT FIXED the issue (not just "resolved" or "complete"). Quote the Resolution. N/A if the ticket remained open after the call.`,
      },
      { slug: '8.16', text: 'Tech Support Specific', type: 'SUB_CATEGORY' },
      {
        slug: '8.17',
        text: 'Was this a tech-support interaction?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        rubric_md: `Gate. YES if the topic involved equipment, devices, firmware, or radio-system troubleshooting per the classification.`,
      },
      {
        slug: '8.18',
        text: 'Was the radio type / equipment field set accurately?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        conditions: [{ target_slug: '8.17' }],
        rubric_md: `Grade against the \`Device Type\` line in the ticket header — this is the dropdown selection the agent made (renders as the human-readable name like "PlayerOne", "SXBR3", "Soundtrack 3.0", "Sonos - SXM Internet", etc.). Do NOT confuse this with the Device ID — they are two separate fields.

YES if Device Type matches the device the customer or notes indicate is in use. NO if mismatched, or if Device Type is blank when a tech-support call clearly involved a specific device. Quote the customer-mentioned device and the header's Device Type value in evidence_quote.`,
      },
      {
        slug: '8.19',
        text: 'Was an accurate device ID or username captured?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        conditions: [{ target_slug: '8.17' }],
        rubric_md: `Grade against the \`Device ID\` line in the ticket header. This is the device's serial number (for hardware devices like SXBR3 / PlayerOne — typical values look like "9LC2TY85", "F37D60") OR the username (for internet devices like SXM App, Soundtrack Player App — typical values look like "CPrater5664"). Distinct from Device Type, which is the dropdown selection.

YES if Device ID is populated and matches a value the customer provided or that system records confirm for this customer's equipment. NO if missing, blank, or wrong. Quote the customer-provided ID (if any) and the header's Device ID value in evidence_quote.`,
      },
      {
        slug: '8.20',
        text: 'Did the troubleshooting steps the agent took match the KB process for this issue?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        conditions: [{ target_slug: '8.17' }],
        rubric_md: `Per the assigned playbook page (or top classification KB hit), did the agent execute the documented steps in the documented order, OR follow an alternate path documented in a linked parent KB page, OR honor a customer-intent diversion? Apply the Resolution-Stop rule — don't penalize for stopping after the issue resolved. YES if the agent's steps in transcript/notes match the KB. NO if the agent skipped foundational steps, did them out of order without resolution, or contradicted KB guidance. Cite the KB page name and the specific step(s) missed. (The R3 roll-up is the critical gate for CRM/KB usage — this detail feeds it.)`,
      },
      { slug: '8.21', text: 'Invoice Specific', type: 'SUB_CATEGORY' },
      {
        slug: '8.22',
        text: 'Was this an invoice-support interaction?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        rubric_md: `Gate. YES if the topic involved billing, an invoice, an order, or payment.`,
      },
      {
        slug: '8.23',
        text: 'Was an accurate order number captured?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        conditions: [{ target_slug: '8.22' }],
        rubric_md: `Grade against the \`Order\` line in the ticket header — renders as \`<OrderNumber> / PO <PONumber> [id <OrderID>]\` (any of those fields may be blank). YES if Order is populated and matches an order the customer referenced. NO if Order is blank when the customer referenced a specific order, or if it points to a different order than the customer described. Quote the customer's order reference and the header's Order value in evidence_quote.`,
      },
      { slug: '8.24', text: 'Installation Specific', type: 'SUB_CATEGORY' },
      {
        slug: '8.25',
        text: 'Was this an installation-support interaction?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        rubric_md: `Gate. YES if the topic involved a scheduled install or post-install issue.`,
      },
      {
        slug: '8.26',
        text: 'Was the correct Job selected on the ticket?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        conditions: [{ target_slug: '8.25' }],
        rubric_md: `Grade against the \`Job\` line in the ticket header — renders as \`<PartnerJobNumber> [id <JobID>]\`. YES if Job is populated and matches the installation job the customer referenced (cross-reference with the \`Site\` line — the job should belong to the same site). NO if Job is blank when the call clearly involved a specific install, or if the job doesn't match the customer's installation. Quote the customer's job reference and the header's Job value in evidence_quote.`,
      },
      { slug: '8.F', text: 'Feedback — Documentation', type: 'TEXT' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'Work From Home Policy',
    weight: 0.05,
    sort: 8,
    questions: [
      {
        slug: 'R9',
        text: 'Did the CSR follow all work-from-home policies during this call?',
        type: 'YES_NO',
        yes_value: 1,
        no_value: 0,
        is_na_allowed: true,
        rubric_md: WFH_AUDIO_REQUIRED,
      },
      {
        slug: '9.1',
        text: 'Was the background free of audible household noise, other voices, music, or TV?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        is_na_allowed: true,
        rubric_md: WFH_AUDIO_REQUIRED,
      },
      {
        slug: '9.2',
        text: 'Was the call taken from a private space (no other voices audible at any point)?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        is_na_allowed: true,
        rubric_md: WFH_AUDIO_REQUIRED,
      },
      {
        slug: '9.3',
        text: 'Was the agent\'s audio quality acceptable (no excessive static, dropout, or echo)?',
        type: 'YES_NO',
        yes_value: 0,
        no_value: 0,
        is_na_allowed: true,
        rubric_md: WFH_AUDIO_REQUIRED,
      },
      { slug: '9.F', text: 'Feedback — WFH Policy', type: 'TEXT' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'Overall Feedback',
    weight: 0.00,
    sort: 9,
    questions: [
      { slug: '10.1', text: 'Overall feedback for the CSR', type: 'TEXT' },
      { slug: '10.2', text: 'Overall feedback for Management', type: 'TEXT' },
    ],
  },
];
