/**
 * Quality Section — Full API Integration Test
 * 
 * Creates a 10-question form (all question types + conditional) and submits
 * 6 audits that end up in different statuses:
 *   A  — Good scores  → FINALIZED (CSR accepts / no dispute)
 *   B  — Poor scores  → DISPUTED  (CSR disputes, manager has NOT resolved yet)
 *   C  — Mixed scores → FINALIZED (CSR accepts / no dispute)
 *   D  — Poor scores  → ADJUSTED  (CSR disputes, manager adjusts to 65)
 *   E  — Good scores  → UPHELD    (CSR disputes, manager upholds original)
 *   F  — Mixed scores → FINALIZED (CSR accepts / no dispute)
 */

import axios, { AxiosInstance } from 'axios';

const BASE = process.env.E2E_BASE_API || 'http://localhost:3000';

// All credentials must come from the environment (typically e2e/.env which is
// gitignored). No fallbacks — committing default emails / passwords here was
// previously flagged as a P0 secret leak.
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`\n  FATAL: required env var ${name} is not set. Configure e2e/.env (see e2e/env.example).`);
    process.exit(1);
  }
  return v;
}

const ADMIN_EMAIL    = requireEnv('E2E_ADMIN_EMAIL');
const ADMIN_PASSWORD = requireEnv('E2E_ADMIN_PASSWORD');
const QA_EMAIL       = requireEnv('E2E_QA_EMAIL');
const QA_PASSWORD    = requireEnv('E2E_QA_PASSWORD');
const CSR_EMAIL      = requireEnv('E2E_CSR_EMAIL');
const CSR_PASSWORD   = requireEnv('E2E_CSR_PASSWORD');
const MGR_EMAIL      = requireEnv('E2E_MANAGER_EMAIL');
const MGR_PASSWORD   = requireEnv('E2E_MANAGER_PASSWORD');

let totalChecks = 0;
let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: string) {
  totalChecks++;
  if (condition) { passed++; console.log(`  [PASS] ${label}`); }
  else           { failed++; console.log(`  [FAIL] ${label}${detail ? ' — ' + detail : ''}`); }
}

async function getCsrf(): Promise<{ csrfToken: string; csrfCookie: string }> {
  const res = await axios.get(`${BASE}/api/csrf-token`, { withCredentials: true });
  const setCookies: string[] = res.headers['set-cookie'] || [];
  const csrfSecret = setCookies.map(c => c.split(';')[0]).find(c => c.startsWith('_csrf='));
  return { csrfToken: res.data.csrfToken, csrfCookie: csrfSecret || '' };
}

async function login(email: string, password: string): Promise<{ token: string; user: any } | null> {
  try {
    const { csrfToken, csrfCookie } = await getCsrf();
    const res = await axios.post(`${BASE}/api/auth/login`, { email, password }, {
      headers: { 'Content-Type': 'application/json', 'X-XSRF-TOKEN': csrfToken, Cookie: csrfCookie },
    });
    return { token: res.data.token, user: res.data.user };
  } catch (e: any) {
    console.log(`  Login failed for ${email}: ${e.response?.status} ${JSON.stringify(e.response?.data || e.message)}`);
    return null;
  }
}

let _csrfToken = '';
let _csrfCookie = '';
async function initCsrf() { const csrf = await getCsrf(); _csrfToken = csrf.csrfToken; _csrfCookie = csrf.csrfCookie; }

function authed(token: string): AxiosInstance {
  return axios.create({
    baseURL: BASE,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-XSRF-TOKEN': _csrfToken, Cookie: _csrfCookie },
    timeout: 30000,
  });
}

// ── Answer builders ──────────────────────────────────────────────────────────

function buildGoodAnswers(questions: any[]): any[] {
  const answers: any[] = [];
  for (const q of questions) {
    switch (q.question_type) {
      case 'YES_NO':      answers.push({ question_id: q.id, answer: 'Yes' }); break;
      case 'SCALE':       answers.push({ question_id: q.id, answer: '5' }); break;
      case 'TEXT':         answers.push({ question_id: q.id, answer: 'Excellent performance observed.' }); break;
      case 'RADIO':        answers.push({ question_id: q.id, answer: '1' }); break;
      case 'MULTI_SELECT': answers.push({ question_id: q.id, answer: '1,2,3' }); break;
    }
  }
  return answers;
}

function buildPoorAnswers(questions: any[]): any[] {
  const answers: any[] = [];
  for (const q of questions) {
    switch (q.question_type) {
      case 'YES_NO':      answers.push({ question_id: q.id, answer: 'No' }); break;
      case 'SCALE':       answers.push({ question_id: q.id, answer: '1' }); break;
      case 'TEXT':         answers.push({ question_id: q.id, answer: 'Needs significant improvement.' }); break;
      case 'RADIO':        answers.push({ question_id: q.id, answer: '4' }); break;
      case 'MULTI_SELECT': answers.push({ question_id: q.id, answer: '1' }); break;
    }
  }
  return answers;
}

function buildMixedAnswers(questions: any[]): any[] {
  const answers: any[] = [];
  for (const q of questions) {
    switch (q.question_type) {
      case 'YES_NO': {
        const yesOrNo = q.question_text.includes('greet') || q.question_text.includes('script') ? 'Yes' : 'No';
        answers.push({ question_id: q.id, answer: yesOrNo });
        break;
      }
      case 'SCALE':       answers.push({ question_id: q.id, answer: '3' }); break;
      case 'TEXT':         answers.push({ question_id: q.id, answer: 'Some areas acceptable, others need work.' }); break;
      case 'RADIO':        answers.push({ question_id: q.id, answer: '2' }); break;
      case 'MULTI_SELECT': answers.push({ question_id: q.id, answer: '1,2' }); break;
    }
  }
  return answers;
}

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n========================================`);
  console.log(`  QTIP Quality Section — API Test v2`);
  console.log(`  Target: ${BASE}`);
  console.log(`========================================\n`);

  await initCsrf();
  console.log('CSRF token acquired.\n');

  // ── Phase 1: Login ──
  console.log('Phase 1: Logging in all users...');

  const adminAuth = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  if (!adminAuth) { console.log('\n  FATAL: Cannot login as admin.'); process.exit(1); }
  console.log(`  Admin: ${adminAuth.user.email} (ID ${adminAuth.user.id})`);

  const qaAuth = await login(QA_EMAIL, QA_PASSWORD);
  if (!qaAuth) { console.log('\n  FATAL: Cannot login as QA.'); process.exit(1); }
  console.log(`  QA: ${qaAuth.user.email} (ID ${qaAuth.user.id})`);

  const csrAuth = await login(CSR_EMAIL, CSR_PASSWORD);
  if (!csrAuth) { console.log('\n  FATAL: Cannot login as CSR.'); process.exit(1); }
  console.log(`  CSR: ${csrAuth.user.email} (ID ${csrAuth.user.id})`);

  const mgrAuth = await login(MGR_EMAIL, MGR_PASSWORD);
  if (!mgrAuth) { console.log('\n  FATAL: Cannot login as Manager.'); process.exit(1); }
  console.log(`  Manager: ${mgrAuth.user.email} (ID ${mgrAuth.user.id})`);

  const adminApi = authed(adminAuth.token);
  const qaApi    = authed(qaAuth.token);
  const csrApi   = authed(csrAuth.token);
  const mgrApi   = authed(mgrAuth.token);
  const csrUserId = csrAuth.user.id;

  // ── Phase 2: Create form ──
  console.log('\nPhase 2: Creating 10-question form...');

  const formPayload = {
    form_name: `E2E Status Test ${new Date().toISOString().slice(0, 16)}`,
    interaction_type: 'CALL',
    is_active: true,
    version: 1,
    categories: [
      {
        category_name: 'Communication', weight: 0.4,
        questions: [
          { question_text: 'Did the agent greet the customer properly?', question_type: 'YES_NO', weight: 0, yes_value: 10, no_value: 0, is_required: true, visible_to_csr: true },
          { question_text: 'Rate the agent tone (1-5)', question_type: 'SCALE', weight: 0, scale_min: 1, scale_max: 5, is_required: true, visible_to_csr: true },
          { question_text: 'Additional notes on communication', question_type: 'TEXT', weight: 0, is_required: false, visible_to_csr: true },
          { question_text: 'Communication guidelines reminder', question_type: 'INFO_BLOCK', weight: 0, is_required: false, visible_to_csr: true },
        ],
      },
      {
        category_name: 'Technical Accuracy', weight: 0.35,
        questions: [
          { question_text: 'Was the information provided accurate?', question_type: 'YES_NO', weight: 0, yes_value: 10, no_value: 0, is_required: true, visible_to_csr: true },
          { question_text: 'Rate the resolution approach', question_type: 'RADIO', weight: 0, is_required: true, visible_to_csr: true, radio_options: [
              { option_text: 'Excellent', option_value: '1', score: 10, has_free_text: false },
              { option_text: 'Good',      option_value: '2', score: 7,  has_free_text: false },
              { option_text: 'Fair',      option_value: '3', score: 4,  has_free_text: false },
              { option_text: 'Poor',      option_value: '4', score: 1,  has_free_text: false },
            ] },
          { question_text: 'Which tools were used?', question_type: 'MULTI_SELECT', weight: 0, is_required: false, visible_to_csr: true, radio_options: [
              { option_text: 'Knowledge Base',   option_value: '1', score: 3, has_free_text: false },
              { option_text: 'CRM',              option_value: '2', score: 3, has_free_text: false },
              { option_text: 'Ticketing System', option_value: '3', score: 3, has_free_text: false },
            ] },
        ],
      },
      {
        category_name: 'Compliance', weight: 0.25,
        questions: [
          { question_text: 'Compliance sub-section', question_type: 'SUB_CATEGORY', weight: 0, is_required: false, visible_to_csr: true },
          { question_text: 'Did the agent follow the required script?', question_type: 'YES_NO', weight: 0, yes_value: 10, no_value: 0, is_required: true, visible_to_csr: true },
          { question_text: 'Was a disclosure provided? (only if script was followed)', question_type: 'YES_NO', weight: 0, yes_value: 10, no_value: 0, is_required: false, visible_to_csr: true,
            is_conditional: true,
            conditions: [{ target_question_id: -9, condition_type: 'EQUALS', target_value: 'Yes', logical_operator: 'AND', group_id: 1, sort_order: 0 }],
          },
        ],
      },
    ],
    metadata_fields: [
      { field_name: 'Reviewer Name',       field_type: 'AUTO',     is_required: true,  interaction_type: 'CALL', sort_order: 0 },
      { field_name: 'Review Date',          field_type: 'AUTO',     is_required: true,  interaction_type: 'CALL', sort_order: 1 },
      { field_name: 'CSR',                  field_type: 'DROPDOWN', is_required: true,  interaction_type: 'CALL', sort_order: 2 },
      { field_name: 'Interaction Date',     field_type: 'DATE',     is_required: true,  interaction_type: 'CALL', sort_order: 3 },
      { field_name: 'Customer ID',          field_type: 'TEXT',     is_required: true,  interaction_type: 'CALL', sort_order: 4 },
      { field_name: 'Customer Name',        field_type: 'TEXT',     is_required: true,  interaction_type: 'CALL', sort_order: 5 },
      { field_name: 'Ticket Number',        field_type: 'TEXT',     is_required: true,  interaction_type: 'CALL', sort_order: 6 },
      { field_name: 'Spacer-2',             field_type: 'SPACER',   is_required: false, interaction_type: 'CALL', sort_order: 7 },
      { field_name: 'Call Conversation ID', field_type: 'TEXT',     is_required: true,  interaction_type: 'CALL', sort_order: 8 },
      { field_name: 'Call Date',            field_type: 'DATE',     is_required: true,  interaction_type: 'CALL', sort_order: 9 },
    ],
  };

  let formId: number;
  try {
    const res = await adminApi.post('/api/forms', formPayload);
    formId = res.data.form_id;
    check('Form created', !!formId, `form_id=${formId}`);
  } catch (e: any) {
    console.log(`  FATAL: Form creation failed: ${e.response?.status} ${JSON.stringify(e.response?.data || e.message)}`);
    process.exit(1);
  }

  const formRes = await adminApi.get(`/api/forms/${formId}`);
  const form = formRes.data;
  check('Form has 3 categories', form.categories?.length === 3);

  const allQuestions: any[] = [];
  for (const cat of form.categories) for (const q of cat.questions) allQuestions.push(q);
  check('Form has 10 questions', allQuestions.length === 10, `got ${allQuestions.length}`);

  const metaMap: Record<string, number> = {};
  for (const mf of form.metadata_fields || []) metaMap[mf.field_name] = mf.id;
  check('CSR metadata field exists', !!metaMap['CSR']);

  const today = new Date().toISOString().split('T')[0];
  const qaUsername = qaAuth.user.username || qaAuth.user.email;
  let custNum = 0;
  const buildMetadata = () => {
    custNum++;
    return [
      { field_id: metaMap['Reviewer Name'],       value: qaUsername },
      { field_id: metaMap['Review Date'],          value: today },
      { field_id: metaMap['CSR'],                  value: String(csrUserId) },
      { field_id: metaMap['Customer ID'],          value: `CUST-${String(custNum).padStart(3, '0')}` },
      { field_id: metaMap['Customer Name'],        value: `Test Customer ${custNum}` },
      { field_id: metaMap['Ticket Number'],        value: `TKT-${String(custNum).padStart(4, '0')}` },
      { field_id: metaMap['Call Conversation ID'], value: `CONV-E2E-${String(custNum).padStart(3, '0')}` },
      { field_id: metaMap['Call Date'],            value: today },
      { field_id: metaMap['Interaction Date'],     value: today },
    ].filter(m => m.field_id);
  };

  // ── Phase 3: QA submits 6 audits ──
  console.log('\nPhase 3: QA submitting 6 audits...');

  const auditDefs = [
    { label: 'A', answers: buildGoodAnswers(allQuestions),  desc: 'good scores' },
    { label: 'B', answers: buildPoorAnswers(allQuestions),  desc: 'poor scores' },
    { label: 'C', answers: buildMixedAnswers(allQuestions), desc: 'mixed scores' },
    { label: 'D', answers: buildPoorAnswers(allQuestions),  desc: 'poor scores' },
    { label: 'E', answers: buildGoodAnswers(allQuestions),  desc: 'good scores' },
    { label: 'F', answers: buildMixedAnswers(allQuestions), desc: 'mixed scores' },
  ];

  const submissionIds: Record<string, number> = {};
  for (const def of auditDefs) {
    try {
      const res = await qaApi.post('/api/submissions', { form_id: formId, answers: def.answers, metadata: buildMetadata() });
      submissionIds[def.label] = res.data.submission_id || res.data.id;
      check(`Audit ${def.label} submitted (${def.desc})`, !!submissionIds[def.label], `id=${submissionIds[def.label]}`);
    } catch (e: any) {
      console.log(`  FATAL: Audit ${def.label} failed: ${e.response?.status} ${JSON.stringify(e.response?.data || e.message)}`);
      process.exit(1);
    }
  }

  // ── Phase 4: QA finalizes all audits ──
  console.log('\nPhase 4: QA finalizing all 6 audits...');
  for (const label of Object.keys(submissionIds)) {
    try {
      await qaApi.put(`/api/qa/submissions/${submissionIds[label]}/finalize`);
      check(`Audit ${label} finalized`, true);
    } catch (e: any) {
      check(`Audit ${label} finalized`, false, `${e.response?.status} ${JSON.stringify(e.response?.data || e.message)}`);
    }
  }

  // ── Phase 5: CSR actions ──
  // A → no action (stays FINALIZED)
  // B → dispute (stays DISPUTED — manager will NOT resolve)
  // C → no action (stays FINALIZED)
  // D → dispute (manager will ADJUST)
  // E → dispute (manager will UPHOLD)
  // F → no action (stays FINALIZED)
  console.log('\nPhase 5: CSR disputing B, D, E...');

  const disputeIds: Record<string, number> = {};
  const disputeTargets = [
    { label: 'B', reason: 'I believe this score does not reflect the quality of the interaction. Please review the recording.' },
    { label: 'D', reason: 'Several answers were marked incorrectly. The agent did follow protocol on most items.' },
    { label: 'E', reason: 'I would like a second review of this audit to confirm the scores are fair.' },
  ];

  for (const dt of disputeTargets) {
    try {
      const res = await csrApi.post('/api/csr/disputes', { submission_id: submissionIds[dt.label], reason: dt.reason });
      disputeIds[dt.label] = res.data.dispute_id || res.data.id;
      check(`CSR disputed Audit ${dt.label}`, !!disputeIds[dt.label], `dispute_id=${disputeIds[dt.label]}`);
    } catch (e: any) {
      check(`CSR disputed Audit ${dt.label}`, false, `${e.response?.status} ${JSON.stringify(e.response?.data || e.message)}`);
    }
  }

  // ── Phase 6: Manager resolves D (ADJUST) and E (UPHOLD). B stays open. ──
  console.log('\nPhase 6: Manager resolving D (ADJUST to 65) and E (UPHOLD)...');

  if (disputeIds['D']) {
    try {
      await mgrApi.post(`/api/manager/disputes/${disputeIds['D']}/resolve`, {
        resolution_action: 'ADJUST',
        resolution_notes: 'After re-listening to the call, the agent did handle several items correctly. Adjusting score to 65.',
        new_score: 65,
      });
      check('Manager ADJUSTED dispute D to 65', true);
    } catch (e: any) {
      check('Manager ADJUSTED dispute D', false, `${e.response?.status} ${JSON.stringify(e.response?.data || e.message)}`);
    }
  }

  if (disputeIds['E']) {
    try {
      await mgrApi.post(`/api/manager/disputes/${disputeIds['E']}/resolve`, {
        resolution_action: 'UPHOLD',
        resolution_notes: 'After review, the original scoring is accurate. No adjustment needed.',
      });
      check('Manager UPHELD dispute E', true);
    } catch (e: any) {
      check('Manager UPHELD dispute E', false, `${e.response?.status} ${JSON.stringify(e.response?.data || e.message)}`);
    }
  }

  console.log('  (Dispute B deliberately left OPEN)');

  // ── Phase 7: Validation ──
  console.log('\nPhase 7: Validating statuses and scores...');

  // Expected final statuses:
  //   A → FINALIZED   (no dispute)
  //   B → DISPUTED    (open dispute)
  //   C → FINALIZED   (no dispute)
  //   D → FINALIZED   (dispute resolved — ADJUST)
  //   E → FINALIZED   (dispute resolved — UPHOLD)
  //   F → FINALIZED   (no dispute)

  const expectedStatuses: Record<string, string> = {
    A: 'FINALIZED',
    B: 'DISPUTED',
    C: 'FINALIZED',
    D: 'FINALIZED',
    E: 'FINALIZED',
    F: 'FINALIZED',
  };

  for (const label of Object.keys(submissionIds)) {
    try {
      const res = await qaApi.get(`/api/qa/completed/${submissionIds[label]}`);
      const status = res.data.status;
      check(`Audit ${label} status = ${expectedStatuses[label]}`, status === expectedStatuses[label], `got ${status}`);

      const sb = res.data.scoreBreakdown;
      if (sb) {
        check(`Audit ${label} has scoreBreakdown`, true);
        console.log(`    ${label}: total_score=${sb.total_score}, categories=${Object.keys(sb.categoryBreakdown || {}).length}`);
      } else {
        check(`Audit ${label} has scoreBreakdown`, false, 'missing');
      }
    } catch (e: any) {
      check(`Audit ${label} status validation`, false, `${e.response?.status}`);
    }
  }

  // Verify dispute statuses
  console.log('\n  Dispute status checks:');
  const expectedDisputeStatuses: Record<string, string> = { B: 'OPEN', D: 'ADJUSTED', E: 'UPHELD' };

  for (const label of Object.keys(disputeIds)) {
    try {
      const res = await csrApi.get(`/api/disputes/${disputeIds[label]}`);
      const dStatus = res.data.status;
      check(`Dispute ${label} status = ${expectedDisputeStatuses[label]}`, dStatus === expectedDisputeStatuses[label], `got ${dStatus}`);
    } catch {
      try {
        const res = await adminApi.get(`/api/disputes/${disputeIds[label]}`);
        const dStatus = res.data.status;
        check(`Dispute ${label} status = ${expectedDisputeStatuses[label]}`, dStatus === expectedDisputeStatuses[label], `got ${dStatus}`);
      } catch (e2: any) {
        check(`Dispute ${label} status check`, false, `${e2.response?.status}`);
      }
    }
  }

  // Verify CSR sees correct statuses
  console.log('\n  CSR audit list:');
  try {
    const res = await csrApi.get('/api/csr/audits?limit=50');
    const audits = res.data.audits || res.data.data || res.data;
    if (Array.isArray(audits)) {
      for (const label of Object.keys(submissionIds)) {
        const a = audits.find((x: any) => x.id === submissionIds[label]);
        if (a) {
          check(`CSR sees Audit ${label} as ${a.status}`, a.status === expectedStatuses[label], `got ${a.status}`);
        }
      }
    }
  } catch (e: any) {
    check('CSR audit list', false, `${e.response?.status}`);
  }

  // Verify score breakdown for Audit D (adjusted)
  if (disputeIds['D']) {
    try {
      const res = await qaApi.get(`/api/qa/completed/${submissionIds['D']}`);
      const dispute = res.data.dispute;
      if (dispute) {
        const adjScore = dispute.new_score != null ? Number(dispute.new_score) : null;
        const prevScore = dispute.previous_score != null ? Number(dispute.previous_score) : null;
        check('Audit D dispute has previous_score', prevScore != null, `${prevScore}`);
        check('Audit D dispute has new_score = 65', adjScore === 65, `got ${adjScore}`);
      }
    } catch (e: any) {
      check('Audit D dispute score check', false, `${e.response?.status}`);
    }
  }

  // ── Summary ──
  console.log('\n========================================');
  console.log(`  RESULTS: ${passed}/${totalChecks} passed, ${failed} failed`);
  console.log('========================================\n');

  console.log('Created resources:');
  console.log(`  Form ID: ${formId}`);
  for (const label of Object.keys(submissionIds)) {
    const status = expectedStatuses[label];
    const dispute = disputeIds[label] ? ` (dispute ${disputeIds[label]})` : '';
    console.log(`  Audit ${label}: submission ${submissionIds[label]} → ${status}${dispute}`);
  }
  console.log();

  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error('Unhandled error:', err.message || err); process.exit(1); });
