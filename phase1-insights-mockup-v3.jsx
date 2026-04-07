import React, { useState, useMemo } from "react";

// ─── Qtip Design Tokens ───
const BRAND = "#00aeef";
const BRAND_DARK = "#0090c7";
const BG = "#f8fafc";
const CARD = "#ffffff";
const BORDER = "#e2e8f0";
const TEXT = "#1e293b";
const TEXT_SUB = "#64748b";
const GREEN = "#22c55e";
const YELLOW = "#eab308";
const RED = "#ef4444";
const ORANGE = "#f97316";
const PURPLE = "#8b5cf6";
const BLUE_LIGHT = "#eff6ff";
const GREEN_LIGHT = "#f0fdf4";
const RED_LIGHT = "#fef2f2";
const YELLOW_LIGHT = "#fefce8";

// ─── COMPLETE KPI DEFINITIONS (28 KPIs: Quality 12, Coaching 8, Quiz 3, Discipline 5) ───
// NOTE: Pace targets (audits per form/week, coaching sessions/week) are configured
// in Insights Engine Settings → KPI Thresholds. The QA auditor sets their expected
// audit volume per form per week; coaching managers set expected sessions per week.
// These targets drive the "assigned" counts and completion percentages below.
const KPI_DEFS = {
  // ══════════ QUALITY (12) ══════════
  avg_qa_score: { name: "Avg QA Score", cat: "Quality", desc: "Average QA score across all finalized submissions.", formula: "AVG(submission.total_score) WHERE status = 'FINALIZED'", src: "Submission.total_score", fmt: "PCT", dir: "UP", bench: "85-95%", goal: 90, warn: 80, crit: 70 },
  audits_assigned: { name: "Audits Assigned", cat: "Quality", desc: "Total QA audits assigned/expected this period based on pace targets set in Settings. Pace = audits per form per week × number of active forms × weeks in period.", formula: "SUM(pace_per_form_per_week × weeks_in_period) across active forms", src: "ie_kpi_threshold + Form", fmt: "NUM", dir: "NEUTRAL", bench: "Set in Settings" },
  audits_completed: { name: "Audits Completed", cat: "Quality", desc: "Total QA audits completed (finalized) this period.", formula: "COUNT(submissions WHERE status = 'FINALIZED' AND submitted_at IN period)", src: "Submission", fmt: "NUM", dir: "UP", bench: "Match assigned" },
  audit_completion_rate: { name: "Audit Completion %", cat: "Quality", desc: "Percentage of assigned/expected audits completed. Based on pace targets set in Settings.", formula: "audits_completed / audits_assigned × 100", src: "Submission + ie_kpi_threshold", fmt: "PCT", dir: "UP", bench: "95%+", goal: 95, warn: 85, crit: 75 },
  dispute_rate: { name: "Dispute Rate", cat: "Quality", desc: "Percentage of finalized submissions disputed. High rates = scorer inconsistency.", formula: "COUNT(disputes) / COUNT(finalized submissions) × 100", src: "Dispute + Submission", fmt: "PCT", dir: "DOWN", bench: "<10%", goal: 5, warn: 10, crit: 20 },
  dispute_upheld_rate: { name: "Dispute Upheld Rate", cat: "Quality", desc: "Of resolved disputes, what % were upheld (agent was right). High = QA calibration needed.", formula: "COUNT(disputes WHERE status = 'UPHELD') / COUNT(resolved disputes) × 100", src: "Dispute", fmt: "PCT", dir: "DOWN", bench: "<15%", goal: 10, warn: 20, crit: 35 },
  dispute_not_upheld_rate: { name: "Dispute Rejected Rate", cat: "Quality", desc: "Percentage of resolved disputes that were rejected (auditor was correct). High rate means agents are disputing unnecessarily.", formula: "COUNT(disputes WHERE status = 'REJECTED') / COUNT(resolved disputes) × 100", src: "Dispute", fmt: "PCT", dir: "NEUTRAL", bench: "Context-dependent", goal: null, warn: null, crit: null },
  avg_dispute_resolution_time: { name: "Avg Resolution Time", cat: "Quality", desc: "Average number of days from dispute creation to resolution.", formula: "AVG(dispute.resolved_at - dispute.created_at) in days", src: "Dispute", fmt: "NUM", dir: "DOWN", bench: "2-5 days", goal: 3, warn: 7, crit: 14 },
  critical_fail_rate: { name: "Critical Fail Rate", cat: "Quality", desc: "Evaluations where an auto-fail question was triggered (compliance, etc.).", formula: "COUNT(submissions with auto-fail triggered) / COUNT(submissions) × 100", src: "SubmissionAnswer + FormQuestion", fmt: "PCT", dir: "DOWN", bench: "<5%", goal: 2, warn: 5, crit: 10 },
  qa_score_trend: { name: "QA Score Trend", cat: "Quality", desc: "Directional trend of avg QA scores over the selected period.", src: "ScoreSnapshot", fmt: "PCT", dir: "UP", bench: "Upward QoQ" },
  time_to_audit: { name: "Time to Audit", cat: "Quality", desc: "Avg days from call date to QA audit completion.", formula: "AVG(submission.submitted_at - call.call_date) in days", src: "Call.call_date → Submission.submitted_at", fmt: "NUM", dir: "DOWN", bench: "2-5 days", goal: 3, warn: 7, crit: 14 },
  dispute_adjusted_rate: { name: "Dispute Adjusted Rate", cat: "Quality", desc: "Percentage of finalized submissions where a dispute resulted in a score adjustment. Measures auditor accuracy — high rate means QA calibration is needed.", formula: "COUNT(disputes WHERE status = 'ADJUSTED') / COUNT(finalized submissions) × 100", src: "Dispute + Submission", fmt: "PCT", dir: "DOWN", bench: "<5%", goal: 3, warn: 8, crit: 15 },

  // ══════════ QUIZ (3 — used in Coaching page) ══════════
  quiz_pass_rate: { name: "Quiz Pass Rate", cat: "Quiz", desc: "Quiz attempts resulting in a passing score.", formula: "COUNT(quiz_attempts WHERE passed = true) / COUNT(quiz_attempts) × 100", src: "QuizAttempt", fmt: "PCT", dir: "UP", bench: "80%+ first attempt", goal: 85, warn: 70, crit: 55 },
  avg_quiz_score: { name: "Avg Quiz Score", cat: "Quiz", desc: "Average score across all quiz attempts.", formula: "AVG(quiz_attempt.score)", src: "QuizAttempt.score", fmt: "PCT", dir: "UP", bench: "80%+", goal: 82, warn: 70, crit: 60 },
  avg_attempts_to_pass: { name: "Avg Attempts to Pass", cat: "Quiz", desc: "Average quiz attempts before passing. Higher = material/quiz issues.", formula: "AVG(attempts per quiz until pass)", src: "QuizAttempt", fmt: "NUM", dir: "DOWN", bench: "1.0-1.3", goal: 1.2, warn: 1.8, crit: 2.5 },

  // ══════════ COACHING (8) ══════════
  coaching_sessions_assigned: { name: "Sessions Assigned", cat: "Coaching", desc: "Total coaching sessions expected this period based on pace targets set in Settings. Pace = sessions per agent per week × active agents × weeks in period.", formula: "pace_per_agent_per_week × active_agent_count × weeks_in_period", src: "ie_kpi_threshold + User", fmt: "NUM", dir: "NEUTRAL", bench: "Set in Settings" },
  coaching_sessions_completed: { name: "Sessions Completed", cat: "Coaching", desc: "Coaching sessions reaching COMPLETED or CLOSED status this period.", formula: "COUNT(sessions WHERE status IN ('COMPLETED','CLOSED') AND completed_at IN period)", src: "CoachingSession", fmt: "NUM", dir: "UP", bench: "Match assigned" },
  coaching_completion_rate: { name: "Coaching Completion %", cat: "Coaching", desc: "Percentage of expected coaching sessions completed. Based on pace targets set in Settings.", formula: "coaching_sessions_completed / coaching_sessions_assigned × 100", src: "CoachingSession + ie_kpi_threshold", fmt: "PCT", dir: "UP", bench: "90%+", goal: 92, warn: 80, crit: 65 },
  coaching_delivery_rate: { name: "Coaching Delivery", cat: "Coaching", desc: "Scheduled sessions actually delivered. Tracks manager follow-through.", formula: "COUNT(sessions WHERE delivered_at IS NOT NULL) / COUNT(sessions) × 100", src: "CoachingSession", fmt: "PCT", dir: "UP", bench: "95%+", goal: 95, warn: 85, crit: 70 },
  avg_days_to_close_coaching: { name: "Avg Days to Close", cat: "Coaching", desc: "Days from coaching creation to completion/closure.", formula: "AVG(completed_at - created_at) in days", src: "CoachingSession", fmt: "NUM", dir: "DOWN", bench: "7-14 days", goal: 10, warn: 21, crit: 30 },
  followup_compliance_rate: { name: "Follow-Up Compliance", cat: "Coaching", desc: "Sessions requiring follow-up where follow-up was completed on time.", formula: "COUNT(follow-ups completed on time) / COUNT(follow-ups required) × 100", src: "CoachingSession", fmt: "PCT", dir: "UP", bench: "90%+", goal: 90, warn: 75, crit: 60 },
  time_to_coaching: { name: "Time to Coaching", cat: "Coaching", desc: "Avg days from triggering event (low QA score) to coaching session.", formula: "AVG(coaching.created_at - submission.submitted_at) in days", src: "Submission → CoachingSession", fmt: "NUM", dir: "DOWN", bench: "3-5 days", goal: 5, warn: 10, crit: 21 },
  coaching_cadence: { name: "Coaching Cadence", cat: "Coaching", desc: "Percentage of expected coaching sessions actually delivered. Based on target frequency set in KPI thresholds (e.g., 1 session per agent per week).", formula: "COUNT(delivered sessions) / (active_agent_count × expected_sessions_per_period) × 100", src: "CoachingSession + ie_kpi_threshold", fmt: "PCT", dir: "UP", bench: "95%+", goal: 95, warn: 80, crit: 60 },

  // ══════════ DISCIPLINE (5) ══════════
  total_writeups_issued: { name: "Write-Ups Issued", cat: "Discipline", desc: "Total write-ups created this period across all departments.", formula: "COUNT(write_ups WHERE created_at IN period)", src: "WriteUp", fmt: "NUM", dir: "DOWN", bench: "Trending down" },
  writeup_rate: { name: "Write-Up Rate", cat: "Discipline", desc: "Write-ups per 100 employees per month.", formula: "COUNT(write_ups) / COUNT(active employees) × 100 per month", src: "WriteUp + User", fmt: "NUM", dir: "NEUTRAL", bench: "Trending down" },
  escalation_rate: { name: "Escalation Rate", cat: "Discipline", desc: "Write-ups escalating from verbal→written or written→final.", formula: "COUNT(escalated write-ups) / COUNT(write-ups) × 100", src: "WriteUp + WriteUpPriorDiscipline", fmt: "PCT", dir: "DOWN", bench: "<20%", goal: 15, warn: 25, crit: 40 },
  repeat_offender_rate: { name: "Repeat Offender Rate", cat: "Discipline", desc: "Agents with a write-up who receive another within 90 days.", formula: "COUNT(agents with 2+ write-ups in 90 days) / COUNT(agents with write-ups) × 100", src: "WriteUp", fmt: "PCT", dir: "DOWN", bench: "<15%", goal: 10, warn: 20, crit: 35 },
  writeup_resolution_rate: { name: "Write-Up Resolution", cat: "Discipline", desc: "Write-ups reaching CLOSED status.", formula: "COUNT(write_ups WHERE status = 'CLOSED') / COUNT(write_ups) × 100", src: "WriteUp", fmt: "PCT", dir: "UP", bench: "90%+", goal: 90, warn: 75, crit: 60 },

};

// ─── MOCK DATA ───
const DEPTS = ["All Departments", "Billing", "Tech Support", "Enterprise Accounts", "Installs", "Tech/Shipping"];
const TIMES = ["Current Week", "Prior Week", "Current Month", "Prior Month", "Current Quarter", "Prior Quarter", "Current Year", "Prior Year", "Custom"];
const FORMS = ["All Forms", "Billing QA Scorecard", "Tech Support QA v2", "Enterprise Evaluation", "Installs Quality Check"];

const D = {
  "All Departments": { avg_qa_score:87.3, audits_assigned:420, audits_completed:390, coaching_sessions_assigned:160, coaching_sessions_completed:126, total_writeups_issued:10, audit_completion_rate:93.1, dispute_rate:7.2, dispute_upheld_rate:12.5, dispute_not_upheld_rate:79.3, avg_dispute_resolution_time:3.2, critical_fail_rate:3.1, time_to_audit:4.2, dispute_adjusted_rate:3.8, quiz_pass_rate:81.2, avg_quiz_score:79.8, avg_attempts_to_pass:1.4, coaching_completion_rate:88.4, coaching_delivery_rate:91.7, avg_days_to_close_coaching:12.3, followup_compliance_rate:82.3, time_to_coaching:6.8, coaching_cadence:89.2, writeup_rate:4.2, escalation_rate:18.1, repeat_offender_rate:12.4, writeup_resolution_rate:84.2},
  "Billing": { avg_qa_score:91.2, audits_assigned:100, audits_completed:95, coaching_sessions_assigned:36, coaching_sessions_completed:30, total_writeups_issued:1, audit_completion_rate:96.0, dispute_rate:4.8, dispute_upheld_rate:8.2, dispute_not_upheld_rate:85.2, avg_dispute_resolution_time:2.1, critical_fail_rate:1.5, time_to_audit:2.8, dispute_adjusted_rate:1.9, quiz_pass_rate:87.5, avg_quiz_score:84.5, avg_attempts_to_pass:1.1, coaching_completion_rate:93.0, coaching_delivery_rate:95.2, avg_days_to_close_coaching:8.5, followup_compliance_rate:89.1, time_to_coaching:3.5, coaching_cadence:96.4, writeup_rate:2.1, escalation_rate:10.5, repeat_offender_rate:5.2, writeup_resolution_rate:92.1},
  "Tech Support": { avg_qa_score:84.6, audits_assigned:130, audits_completed:120, coaching_sessions_assigned:40, coaching_sessions_completed:31, total_writeups_issued:3, audit_completion_rate:91.2, dispute_rate:9.8, dispute_upheld_rate:16.9, dispute_not_upheld_rate:72.1, avg_dispute_resolution_time:4.5, critical_fail_rate:4.7, time_to_audit:5.1, dispute_adjusted_rate:6.2, quiz_pass_rate:74.1, avg_quiz_score:73.9, avg_attempts_to_pass:1.7, coaching_completion_rate:85.2, coaching_delivery_rate:88.4, avg_days_to_close_coaching:16.2, followup_compliance_rate:76.5, time_to_coaching:9.2, coaching_cadence:82.1, writeup_rate:6.8, escalation_rate:24.3, repeat_offender_rate:18.7, writeup_resolution_rate:78.5},
  "Enterprise Accounts": { avg_qa_score:89.4, audits_assigned:75, audits_completed:70, coaching_sessions_assigned:30, coaching_sessions_completed:26, total_writeups_issued:1, audit_completion_rate:94.5, dispute_rate:5.1, dispute_upheld_rate:9.1, dispute_not_upheld_rate:82.5, avg_dispute_resolution_time:2.8, critical_fail_rate:2.0, time_to_audit:3.5, dispute_adjusted_rate:2.5, quiz_pass_rate:85.9, avg_quiz_score:82.7, avg_attempts_to_pass:1.2, coaching_completion_rate:91.5, coaching_delivery_rate:94.8, avg_days_to_close_coaching:9.8, followup_compliance_rate:87.3, time_to_coaching:4.8, coaching_cadence:93.8, writeup_rate:1.5, escalation_rate:8.2, repeat_offender_rate:4.0, writeup_resolution_rate:95.0},
  "Installs": { avg_qa_score:82.1, audits_assigned:72, audits_completed:60, coaching_sessions_assigned:28, coaching_sessions_completed:18, total_writeups_issued:4, audit_completion_rate:88.7, dispute_rate:11.2, dispute_upheld_rate:19.3, dispute_not_upheld_rate:68.4, avg_dispute_resolution_time:5.2, critical_fail_rate:5.5, time_to_audit:6.8, dispute_adjusted_rate:8.1, quiz_pass_rate:72.8, avg_quiz_score:71.2, avg_attempts_to_pass:1.9, coaching_completion_rate:81.3, coaching_delivery_rate:85.1, avg_days_to_close_coaching:18.5, followup_compliance_rate:71.8, time_to_coaching:11.5, coaching_cadence:78.5, writeup_rate:7.5, escalation_rate:28.7, repeat_offender_rate:22.1, writeup_resolution_rate:72.5},
  "Tech/Shipping": { avg_qa_score:86.8, audits_assigned:48, audits_completed:45, coaching_sessions_assigned:24, coaching_sessions_completed:18, total_writeups_issued:1, audit_completion_rate:92.4, dispute_rate:6.5, dispute_upheld_rate:11.8, dispute_not_upheld_rate:78.0, avg_dispute_resolution_time:3.0, critical_fail_rate:2.8, time_to_audit:4.0, dispute_adjusted_rate:3.2, quiz_pass_rate:80.0, avg_quiz_score:78.5, avg_attempts_to_pass:1.5, coaching_completion_rate:87.9, coaching_delivery_rate:90.3, avg_days_to_close_coaching:11.1, followup_compliance_rate:80.5, time_to_coaching:5.5, coaching_cadence:88.0, writeup_rate:3.8, escalation_rate:15.9, repeat_offender_rate:10.8, writeup_resolution_rate:86.0},
};

// ─── PRIOR PERIOD MOCK DATA (for period-over-period comparison on tiles) ───
// When time = "Current Month", prior = last month's values. Current Week → prior week, etc.
const P = {
  "All Departments": { avg_qa_score:85.9, audits_assigned:420, audits_completed:372, coaching_sessions_assigned:160, coaching_sessions_completed:118, total_writeups_issued:12, audit_completion_rate:88.6, dispute_rate:8.1, dispute_upheld_rate:14.2, dispute_not_upheld_rate:76.8, avg_dispute_resolution_time:3.8, critical_fail_rate:3.8, time_to_audit:4.9, dispute_adjusted_rate:4.5, quiz_pass_rate:78.4, avg_quiz_score:77.1, avg_attempts_to_pass:1.5, coaching_completion_rate:84.1, coaching_delivery_rate:88.5, avg_days_to_close_coaching:14.1, followup_compliance_rate:78.9, time_to_coaching:7.5, coaching_cadence:85.8, writeup_rate:5.1, escalation_rate:20.3, repeat_offender_rate:14.8, writeup_resolution_rate:80.1 },
  "Billing": { avg_qa_score:89.8, audits_assigned:100, audits_completed:90, coaching_sessions_assigned:36, coaching_sessions_completed:28, total_writeups_issued:2, audit_completion_rate:90.0, dispute_rate:5.5, dispute_upheld_rate:9.8, dispute_not_upheld_rate:82.1, avg_dispute_resolution_time:2.5, critical_fail_rate:2.1, time_to_audit:3.2, dispute_adjusted_rate:2.8, quiz_pass_rate:84.2, avg_quiz_score:81.9, avg_attempts_to_pass:1.2, coaching_completion_rate:90.1, coaching_delivery_rate:92.8, avg_days_to_close_coaching:9.8, followup_compliance_rate:86.2, time_to_coaching:4.1, coaching_cadence:93.1, writeup_rate:2.8, escalation_rate:12.1, repeat_offender_rate:6.8, writeup_resolution_rate:88.5 },
  "Tech Support": { avg_qa_score:82.1, audits_assigned:130, audits_completed:112, coaching_sessions_assigned:40, coaching_sessions_completed:28, total_writeups_issued:4, audit_completion_rate:86.2, dispute_rate:11.5, dispute_upheld_rate:19.1, dispute_not_upheld_rate:68.5, avg_dispute_resolution_time:5.2, critical_fail_rate:5.9, time_to_audit:5.8, dispute_adjusted_rate:7.8, quiz_pass_rate:70.5, avg_quiz_score:70.8, avg_attempts_to_pass:1.9, coaching_completion_rate:81.0, coaching_delivery_rate:84.2, avg_days_to_close_coaching:18.5, followup_compliance_rate:72.1, time_to_coaching:10.8, coaching_cadence:78.4, writeup_rate:7.9, escalation_rate:27.1, repeat_offender_rate:21.5, writeup_resolution_rate:74.2 },
  "Enterprise Accounts": { avg_qa_score:88.1, audits_assigned:75, audits_completed:66, coaching_sessions_assigned:30, coaching_sessions_completed:24, total_writeups_issued:2, audit_completion_rate:88.0, dispute_rate:6.2, dispute_upheld_rate:10.5, dispute_not_upheld_rate:80.1, avg_dispute_resolution_time:3.2, critical_fail_rate:2.5, time_to_audit:4.1, dispute_adjusted_rate:3.1, quiz_pass_rate:83.2, avg_quiz_score:80.1, avg_attempts_to_pass:1.3, coaching_completion_rate:88.5, coaching_delivery_rate:92.1, avg_days_to_close_coaching:11.2, followup_compliance_rate:84.5, time_to_coaching:5.5, coaching_cadence:90.2, writeup_rate:2.1, escalation_rate:9.8, repeat_offender_rate:5.2, writeup_resolution_rate:91.5 },
  "Installs": { avg_qa_score:80.5, audits_assigned:72, audits_completed:55, coaching_sessions_assigned:28, coaching_sessions_completed:15, total_writeups_issued:5, audit_completion_rate:76.4, dispute_rate:13.1, dispute_upheld_rate:22.5, dispute_not_upheld_rate:65.2, avg_dispute_resolution_time:6.1, critical_fail_rate:6.8, time_to_audit:7.5, dispute_adjusted_rate:9.5, quiz_pass_rate:69.1, avg_quiz_score:68.5, avg_attempts_to_pass:2.1, coaching_completion_rate:76.8, coaching_delivery_rate:81.2, avg_days_to_close_coaching:21.2, followup_compliance_rate:68.5, time_to_coaching:13.2, coaching_cadence:74.1, writeup_rate:8.5, escalation_rate:31.2, repeat_offender_rate:25.8, writeup_resolution_rate:68.2 },
  "Tech/Shipping": { avg_qa_score:85.2, audits_assigned:48, audits_completed:42, coaching_sessions_assigned:24, coaching_sessions_completed:16, total_writeups_issued:2, audit_completion_rate:87.5, dispute_rate:7.2, dispute_upheld_rate:13.5, dispute_not_upheld_rate:75.2, avg_dispute_resolution_time:3.5, critical_fail_rate:3.5, time_to_audit:4.5, dispute_adjusted_rate:4.1, quiz_pass_rate:77.2, avg_quiz_score:75.8, avg_attempts_to_pass:1.6, coaching_completion_rate:84.5, coaching_delivery_rate:87.1, avg_days_to_close_coaching:12.8, followup_compliance_rate:77.2, time_to_coaching:6.2, coaching_cadence:84.5, writeup_rate:4.5, escalation_rate:18.2, repeat_offender_rate:12.5, writeup_resolution_rate:82.1 },
};

const mockAgents = [
  { name:"Sarah Mitchell", dept:"Billing", qa:95.2, trend:"+2.1", coaching:2, quiz:91, disputes:0, writeups:0, risk:false, cadence:4, expected:4 },
  { name:"James Cooper", dept:"Billing", qa:88.7, trend:"+0.8", coaching:1, quiz:82, disputes:1, writeups:0, risk:false, cadence:3, expected:4 },
  { name:"Maria Santos", dept:"Tech Support", qa:79.3, trend:"-1.4", coaching:4, quiz:71, disputes:3, writeups:1, risk:true, cadence:2, expected:4 },
  { name:"David Kim", dept:"Tech Support", qa:88.1, trend:"+3.2", coaching:1, quiz:85, disputes:1, writeups:0, risk:false, cadence:4, expected:4 },
  { name:"Lisa Thompson", dept:"Enterprise Accounts", qa:93.5, trend:"+1.5", coaching:0, quiz:89, disputes:0, writeups:0, risk:false, cadence:4, expected:4 },
  { name:"Robert Chen", dept:"Enterprise Accounts", qa:86.2, trend:"-0.3", coaching:2, quiz:80, disputes:2, writeups:0, risk:false, cadence:3, expected:4 },
  { name:"Ashley Brown", dept:"Installs", qa:76.4, trend:"-2.8", coaching:5, quiz:65, disputes:4, writeups:2, risk:true, cadence:1, expected:4 },
  { name:"Michael Davis", dept:"Installs", qa:85.8, trend:"+1.1", coaching:2, quiz:78, disputes:1, writeups:0, risk:false, cadence:3, expected:4 },
  { name:"Jennifer White", dept:"Tech/Shipping", qa:90.1, trend:"+0.5", coaching:1, quiz:86, disputes:0, writeups:0, risk:false, cadence:4, expected:4 },
  { name:"Chris Johnson", dept:"Tech/Shipping", qa:83.5, trend:"-0.9", coaching:3, quiz:74, disputes:2, writeups:1, risk:true, cadence:2, expected:4 },
];

const trendData = [
  { m:"Nov", qa:84.1, tr:79.2, co:82.5, cad:86.2 }, { m:"Dec", qa:85.3, tr:81.1, co:84.2, cad:88.1 },
  { m:"Jan", qa:83.8, tr:80.5, co:85.8, cad:85.5 }, { m:"Feb", qa:86.2, tr:82.7, co:87.1, cad:89.7 },
  { m:"Mar", qa:87.9, tr:84.1, co:88.4, cad:90.2 }, { m:"Apr", qa:87.3, tr:84.6, co:88.4, cad:89.2 },
];

// ─── BELL CURVE MOCK DATA (score distribution buckets) ───
const scoreDistributions = {
  "All Forms": [
    { range:"40-49", count:2 }, { range:"50-59", count:5 }, { range:"60-69", count:12 },
    { range:"70-74", count:18 }, { range:"75-79", count:31 }, { range:"80-84", count:47 },
    { range:"85-89", count:62 }, { range:"90-94", count:54 }, { range:"95-100", count:28 },
  ],
  "Billing QA Scorecard": [
    { range:"40-49", count:0 }, { range:"50-59", count:1 }, { range:"60-69", count:4 },
    { range:"70-74", count:6 }, { range:"75-79", count:10 }, { range:"80-84", count:15 },
    { range:"85-89", count:22 }, { range:"90-94", count:26 }, { range:"95-100", count:18 },
  ],
  "Tech Support QA v2": [
    { range:"40-49", count:1 }, { range:"50-59", count:3 }, { range:"60-69", count:8 },
    { range:"70-74", count:14 }, { range:"75-79", count:19 }, { range:"80-84", count:24 },
    { range:"85-89", count:18 }, { range:"90-94", count:12 }, { range:"95-100", count:5 },
  ],
  "Enterprise Evaluation": [
    { range:"40-49", count:0 }, { range:"50-59", count:1 }, { range:"60-69", count:2 },
    { range:"70-74", count:4 }, { range:"75-79", count:8 }, { range:"80-84", count:12 },
    { range:"85-89", count:18 }, { range:"90-94", count:15 }, { range:"95-100", count:10 },
  ],
  "Installs Quality Check": [
    { range:"40-49", count:1 }, { range:"50-59", count:2 }, { range:"60-69", count:6 },
    { range:"70-74", count:10 }, { range:"75-79", count:14 }, { range:"80-84", count:12 },
    { range:"85-89", count:8 }, { range:"90-94", count:5 }, { range:"95-100", count:2 },
  ],
};

// ─── TOP MISSED QUESTIONS MOCK DATA ───
const topMissedQuestions = {
  "All Forms": [
    { question:"Proper Opening Greeting", form:"Tech Support QA v2", failRate:34.2, evalCount:120, trend:"-2.1", topMiss:"Skipped company name" },
    { question:"Upsell/Retention Offer", form:"Billing QA Scorecard", failRate:28.8, evalCount:95, trend:"+1.5", topMiss:"Did not present retention offer" },
    { question:"Pre-Install Communication", form:"Installs Quality Check", failRate:26.4, evalCount:60, trend:"-0.3", topMiss:"Missing confirmation call" },
    { question:"Troubleshooting Process", form:"Tech Support QA v2", failRate:22.1, evalCount:120, trend:"+2.8", topMiss:"Skipped basic steps" },
    { question:"Resolution Verification", form:"Tech Support QA v2", failRate:19.5, evalCount:120, trend:"+1.5", topMiss:"Did not confirm resolution" },
    { question:"Scheduling Accuracy", form:"Installs Quality Check", failRate:18.3, evalCount:60, trend:"+1.8", topMiss:"Wrong time zone noted" },
    { question:"Contract/SLA Knowledge", form:"Enterprise Evaluation", failRate:16.2, evalCount:70, trend:"-0.5", topMiss:"Incorrect SLA tier quoted" },
    { question:"Payment Processing", form:"Billing QA Scorecard", failRate:12.5, evalCount:95, trend:"-0.4", topMiss:"Missed payment confirmation read-back" },
    { question:"Technical Documentation", form:"Installs Quality Check", failRate:11.8, evalCount:60, trend:"+2.2", topMiss:"Incomplete equipment list" },
    { question:"Technical Accuracy", form:"Tech Support QA v2", failRate:10.9, evalCount:120, trend:"-1.2", topMiss:"Incorrect troubleshooting guidance" },
  ],
  "Billing QA Scorecard": [
    { question:"Upsell/Retention Offer", form:"Billing QA Scorecard", failRate:28.8, evalCount:95, trend:"+1.5", topMiss:"Did not present retention offer" },
    { question:"Payment Processing", form:"Billing QA Scorecard", failRate:12.5, evalCount:95, trend:"-0.4", topMiss:"Missed payment confirmation read-back" },
    { question:"Billing Inquiry Handling", form:"Billing QA Scorecard", failRate:8.4, evalCount:95, trend:"+2.3", topMiss:"Incomplete charge explanation" },
    { question:"Account Verification", form:"Billing QA Scorecard", failRate:4.2, evalCount:95, trend:"+1.1", topMiss:"Only 2 of 3 verification steps" },
    { question:"Call Opening", form:"Billing QA Scorecard", failRate:3.1, evalCount:95, trend:"+0.8", topMiss:"Missing department identification" },
  ],
  "Tech Support QA v2": [
    { question:"Proper Opening Greeting", form:"Tech Support QA v2", failRate:34.2, evalCount:120, trend:"-2.1", topMiss:"Skipped company name" },
    { question:"Troubleshooting Process", form:"Tech Support QA v2", failRate:22.1, evalCount:120, trend:"+2.8", topMiss:"Skipped basic steps" },
    { question:"Resolution Verification", form:"Tech Support QA v2", failRate:19.5, evalCount:120, trend:"+1.5", topMiss:"Did not confirm resolution" },
    { question:"Technical Accuracy", form:"Tech Support QA v2", failRate:10.9, evalCount:120, trend:"-1.2", topMiss:"Incorrect troubleshooting guidance" },
    { question:"Documentation", form:"Tech Support QA v2", failRate:8.7, evalCount:120, trend:"+0.4", topMiss:"Missing ticket notes" },
  ],
  "Enterprise Evaluation": [
    { question:"Contract/SLA Knowledge", form:"Enterprise Evaluation", failRate:16.2, evalCount:70, trend:"-0.5", topMiss:"Incorrect SLA tier quoted" },
    { question:"Solution Design", form:"Enterprise Evaluation", failRate:11.1, evalCount:70, trend:"+2.1", topMiss:"Did not tailor to account size" },
    { question:"Follow-Through", form:"Enterprise Evaluation", failRate:9.8, evalCount:70, trend:"+1.2", topMiss:"No follow-up scheduled" },
    { question:"Account Review", form:"Enterprise Evaluation", failRate:6.5, evalCount:70, trend:"+1.0", topMiss:"Missed recent service history" },
    { question:"Professional Greeting", form:"Enterprise Evaluation", failRate:2.1, evalCount:70, trend:"+0.3", topMiss:"Did not reference account name" },
  ],
  "Installs Quality Check": [
    { question:"Pre-Install Communication", form:"Installs Quality Check", failRate:26.4, evalCount:60, trend:"-0.3", topMiss:"Missing confirmation call" },
    { question:"Scheduling Accuracy", form:"Installs Quality Check", failRate:18.3, evalCount:60, trend:"+1.8", topMiss:"Wrong time zone noted" },
    { question:"Technical Documentation", form:"Installs Quality Check", failRate:11.8, evalCount:60, trend:"+2.2", topMiss:"Incomplete equipment list" },
    { question:"Customer Handoff", form:"Installs Quality Check", failRate:8.2, evalCount:60, trend:"+0.9", topMiss:"No post-install walkthrough" },
  ],
};

const formCategories = {
  "All Forms": [
    { cat:"Opening & Greeting", score:92.1, goal:90, trend:"+1.3" },
    { cat:"Customer Identification", score:94.8, goal:95, trend:"+0.2" },
    { cat:"Needs Assessment", score:85.4, goal:88, trend:"+2.1" },
    { cat:"Product Knowledge", score:81.2, goal:85, trend:"-0.8" },
    { cat:"Resolution & Accuracy", score:83.7, goal:88, trend:"+1.5" },
    { cat:"Communication Skills", score:88.9, goal:85, trend:"+0.7" },
    { cat:"Closing & Wrap-Up", score:90.5, goal:90, trend:"+0.3" },
    { cat:"Compliance", score:96.2, goal:98, trend:"-0.5" },
  ],
  "Billing QA Scorecard": [
    { cat:"Call Opening", score:93.5, goal:90, trend:"+0.8" },
    { cat:"Account Verification", score:96.1, goal:95, trend:"+1.1" },
    { cat:"Billing Inquiry Handling", score:89.2, goal:88, trend:"+2.3" },
    { cat:"Payment Processing", score:91.8, goal:92, trend:"-0.4" },
    { cat:"Upsell/Retention", score:78.4, goal:80, trend:"+1.9" },
    { cat:"Compliance & Disclosures", score:97.5, goal:98, trend:"+0.2" },
    { cat:"Call Closing", score:92.0, goal:90, trend:"+0.5" },
  ],
  "Tech Support QA v2": [
    { cat:"Greeting & Empathy", score:88.3, goal:85, trend:"+1.1" },
    { cat:"Troubleshooting Process", score:79.8, goal:85, trend:"+2.8" },
    { cat:"Technical Accuracy", score:82.5, goal:88, trend:"-1.2" },
    { cat:"Documentation", score:86.1, goal:85, trend:"+0.4" },
    { cat:"Escalation Handling", score:91.2, goal:90, trend:"+0.7" },
    { cat:"Resolution Verification", score:84.7, goal:88, trend:"+1.5" },
  ],
  "Enterprise Evaluation": [
    { cat:"Professional Greeting", score:95.2, goal:95, trend:"+0.3" },
    { cat:"Account Review", score:90.1, goal:90, trend:"+1.0" },
    { cat:"Solution Design", score:87.8, goal:88, trend:"+2.1" },
    { cat:"Contract/SLA Knowledge", score:85.4, goal:88, trend:"-0.5" },
    { cat:"Follow-Through", score:88.9, goal:90, trend:"+1.2" },
  ],
  "Installs Quality Check": [
    { cat:"Scheduling Accuracy", score:82.3, goal:90, trend:"+1.8" },
    { cat:"Pre-Install Communication", score:78.9, goal:85, trend:"-0.3" },
    { cat:"Technical Documentation", score:80.5, goal:85, trend:"+2.2" },
    { cat:"Customer Handoff", score:85.1, goal:88, trend:"+0.9" },
  ],
};

// ─── SCORE BY FORM MOCK DATA ───
const scoreByForm = {
  "All Departments": [
    { form: "Billing QA Scorecard", avg: 91.2, evals: 95, trend: "+1.2", goal: 90 },
    { form: "Tech Support QA v2", avg: 84.6, evals: 120, trend: "+1.8", goal: 85 },
    { form: "Enterprise Evaluation", avg: 89.4, evals: 70, trend: "+0.5", goal: 88 },
    { form: "Installs Quality Check", avg: 82.1, evals: 60, trend: "-0.3", goal: 85 },
    { form: "Tech/Shipping QA v1", avg: 86.8, evals: 45, trend: "+0.9", goal: 85 },
  ],
  "Billing": [
    { form: "Billing QA Scorecard", avg: 91.2, evals: 95, trend: "+1.2", goal: 90 },
  ],
  "Tech Support": [
    { form: "Tech Support QA v2", avg: 84.6, evals: 120, trend: "+1.8", goal: 85 },
  ],
  "Enterprise Accounts": [
    { form: "Enterprise Evaluation", avg: 89.4, evals: 70, trend: "+0.5", goal: 88 },
  ],
  "Installs": [
    { form: "Installs Quality Check", avg: 82.1, evals: 60, trend: "-0.3", goal: 85 },
  ],
  "Tech/Shipping": [
    { form: "Tech/Shipping QA v1", avg: 86.8, evals: 45, trend: "+0.9", goal: 85 },
  ],
};

// ─── COACHING MOCK DATA ───
const coachingTopics = [
  { topic: "Call Opening & Greeting", count: 28, agents: 14, repeatRate: 35.7 },
  { topic: "Upsell/Retention Offers", count: 22, agents: 11, repeatRate: 27.3 },
  { topic: "Troubleshooting Process", count: 19, agents: 10, repeatRate: 40.0 },
  { topic: "Resolution Verification", count: 16, agents: 9, repeatRate: 22.2 },
  { topic: "Documentation & Notes", count: 14, agents: 10, repeatRate: 10.0 },
  { topic: "Compliance & Disclosures", count: 12, agents: 8, repeatRate: 12.5 },
  { topic: "Customer Empathy", count: 10, agents: 8, repeatRate: 0 },
  { topic: "Technical Accuracy", count: 8, agents: 6, repeatRate: 16.7 },
];

const coachingTopicAgents = {
  "Call Opening & Greeting": [
    { name: "Maria Santos", dept: "Tech Support", sessions: 4, lastCoached: "Apr 1", accounts: "Acme Corp, TechNow Inc", repeat: true },
    { name: "Ashley Brown", dept: "Installs", sessions: 3, lastCoached: "Mar 28", accounts: "Global Solutions, Peak Systems", repeat: true },
    { name: "Chris Johnson", dept: "Tech/Shipping", sessions: 2, lastCoached: "Mar 25", accounts: "DataFlow Ltd", repeat: true },
    { name: "James Cooper", dept: "Billing", sessions: 1, lastCoached: "Apr 3", accounts: "Metro Services", repeat: false },
    { name: "Michael Davis", dept: "Installs", sessions: 1, lastCoached: "Mar 30", accounts: "Quick Logistics", repeat: false },
  ],
  "Upsell/Retention Offers": [
    { name: "James Cooper", dept: "Billing", sessions: 3, lastCoached: "Apr 2", accounts: "Valley Health, UrbanNet", repeat: true },
    { name: "Maria Santos", dept: "Tech Support", sessions: 2, lastCoached: "Mar 31", accounts: "Apex Digital", repeat: true },
    { name: "Chris Johnson", dept: "Tech/Shipping", sessions: 1, lastCoached: "Mar 22", accounts: "ClearView Tech", repeat: false },
  ],
  "Troubleshooting Process": [
    { name: "Maria Santos", dept: "Tech Support", sessions: 4, lastCoached: "Apr 4", accounts: "Meridian Group, SkyPeak", repeat: true },
    { name: "Ashley Brown", dept: "Installs", sessions: 3, lastCoached: "Mar 29", accounts: "Pinnacle Inc, RapidServe", repeat: true },
    { name: "David Kim", dept: "Tech Support", sessions: 2, lastCoached: "Apr 1", accounts: "BrightPath Co", repeat: true },
    { name: "Chris Johnson", dept: "Tech/Shipping", sessions: 1, lastCoached: "Mar 26", accounts: "NexGen Systems", repeat: false },
  ],
};

const repeatOffenders = [
  { name: "Maria Santos", dept: "Tech Support", totalSessions: 12, uniqueTopics: 3, repeatTopics: 3, qa: 79.3, topics: [{ topic: "Troubleshooting Process", count: 4 }, { topic: "Call Opening & Greeting", count: 3 }, { topic: "Upsell/Retention Offers", count: 2 }] },
  { name: "Ashley Brown", dept: "Installs", totalSessions: 10, uniqueTopics: 3, repeatTopics: 2, qa: 76.4, topics: [{ topic: "Call Opening & Greeting", count: 3 }, { topic: "Troubleshooting Process", count: 3 }, { topic: "Documentation & Notes", count: 1 }] },
  { name: "Chris Johnson", dept: "Tech/Shipping", totalSessions: 7, uniqueTopics: 4, repeatTopics: 2, qa: 83.5, topics: [{ topic: "Troubleshooting Process", count: 2 }, { topic: "Call Opening & Greeting", count: 2 }, { topic: "Upsell/Retention Offers", count: 1 }] },
  { name: "James Cooper", dept: "Billing", totalSessions: 5, uniqueTopics: 2, repeatTopics: 1, qa: 88.7, topics: [{ topic: "Upsell/Retention Offers", count: 3 }, { topic: "Call Opening & Greeting", count: 1 }] },
  { name: "David Kim", dept: "Tech Support", totalSessions: 4, uniqueTopics: 2, repeatTopics: 1, qa: 88.1, topics: [{ topic: "Troubleshooting Process", count: 2 }, { topic: "Technical Accuracy", count: 1 }] },
];

const quizList = [
  { name: "Product Knowledge v3", attempts: 48, passRate: 54.2, avgScore: 61.3, avgAttempts: 2.1, fails: 22 },
  { name: "Billing Procedures 2025", attempts: 35, passRate: 82.9, avgScore: 80.1, avgAttempts: 1.2, fails: 6 },
  { name: "Compliance Basics", attempts: 42, passRate: 95.2, avgScore: 91.4, avgAttempts: 1.0, fails: 2 },
  { name: "Troubleshooting Fundamentals", attempts: 38, passRate: 68.4, avgScore: 69.8, avgAttempts: 1.8, fails: 12 },
  { name: "Customer Empathy & De-escalation", attempts: 30, passRate: 76.7, avgScore: 74.2, avgAttempts: 1.5, fails: 7 },
  { name: "New Hire Orientation", attempts: 22, passRate: 90.9, avgScore: 87.6, avgAttempts: 1.1, fails: 2 },
  { name: "Upsell Techniques", attempts: 32, passRate: 62.5, avgScore: 65.1, avgAttempts: 1.9, fails: 12 },
];

const agentsFailedQuizzes = [
  { name: "Ashley Brown", dept: "Installs", failed: 5, quizzes: ["Product Knowledge v3", "Troubleshooting Fundamentals", "Upsell Techniques"], avgScore: 52.1, qa: 76.4 },
  { name: "Maria Santos", dept: "Tech Support", failed: 4, quizzes: ["Product Knowledge v3", "Troubleshooting Fundamentals"], avgScore: 58.3, qa: 79.3 },
  { name: "Chris Johnson", dept: "Tech/Shipping", failed: 3, quizzes: ["Product Knowledge v3", "Customer Empathy & De-escalation"], avgScore: 61.2, qa: 83.5 },
  { name: "James Cooper", dept: "Billing", failed: 2, quizzes: ["Upsell Techniques"], avgScore: 63.8, qa: 88.7 },
  { name: "Michael Davis", dept: "Installs", failed: 2, quizzes: ["Product Knowledge v3", "Upsell Techniques"], avgScore: 59.5, qa: 85.8 },
];

// ─── POLICY → AGENTS MAPPING (for Most Violated Policies drill-down) ───
const policyAgents = {
  "Attendance Policy": [
    { name: "Ashley Brown", dept: "Installs", type: "WRITTEN_WARNING", status: "FOLLOW_UP_PENDING" },
    { name: "David Kim", dept: "Tech Support", type: "FINAL_WARNING", status: "AWAITING_SIGNATURE" },
    { name: "Chris Johnson", dept: "Tech/Shipping", type: "VERBAL_WARNING", status: "CLOSED" },
  ],
  "Customer Communication Standards": [
    { name: "Ashley Brown", dept: "Installs", type: "WRITTEN_WARNING", status: "FOLLOW_UP_PENDING" },
    { name: "Robert Chen", dept: "Enterprise Accounts", type: "VERBAL_WARNING", status: "SIGNED" },
  ],
  "Troubleshooting SOP": [
    { name: "Maria Santos", dept: "Tech Support", type: "VERBAL_WARNING", status: "DELIVERED" },
    { name: "Chris Johnson", dept: "Tech/Shipping", type: "VERBAL_WARNING", status: "CLOSED" },
  ],
  "Quality Standards": [
    { name: "Maria Santos", dept: "Tech Support", type: "VERBAL_WARNING", status: "DELIVERED" },
  ],
  "Documentation Requirements": [
    { name: "Chris Johnson", dept: "Tech/Shipping", type: "VERBAL_WARNING", status: "CLOSED" },
  ],
  "Code of Conduct": [
    { name: "David Kim", dept: "Tech Support", type: "FINAL_WARNING", status: "AWAITING_SIGNATURE" },
  ],
  "Billing Accuracy Policy": [
    { name: "James Cooper", dept: "Billing", type: "WRITTEN_WARNING", status: "DRAFT" },
  ],
};

// ─── AGENT FORM REVIEWS (for Agent Profile forms performance drill-down) ───
// Each entry = one finalized QA evaluation. Caret expands to show review date, call date, score.
const agentFormReviews = {
  "Sarah Mitchell": [
    { form: "Billing QA Scorecard", reviewDate: "Apr 4", callDate: "Apr 2", score: 97.1 },
    { form: "Billing QA Scorecard", reviewDate: "Apr 1", callDate: "Mar 30", score: 94.5 },
    { form: "Billing QA Scorecard", reviewDate: "Mar 28", callDate: "Mar 26", score: 96.8 },
    { form: "Billing QA Scorecard", reviewDate: "Mar 24", callDate: "Mar 22", score: 93.2 },
    { form: "Billing QA Scorecard", reviewDate: "Mar 20", callDate: "Mar 18", score: 95.9 },
    { form: "Billing QA Scorecard", reviewDate: "Mar 16", callDate: "Mar 14", score: 92.4 },
    { form: "Billing QA Scorecard", reviewDate: "Mar 12", callDate: "Mar 10", score: 98.1 },
    { form: "Billing QA Scorecard", reviewDate: "Mar 8", callDate: "Mar 6", score: 93.6 },
  ],
  "James Cooper": [
    { form: "Billing QA Scorecard", reviewDate: "Apr 3", callDate: "Apr 1", score: 91.2 },
    { form: "Billing QA Scorecard", reviewDate: "Mar 30", callDate: "Mar 28", score: 85.4 },
    { form: "Billing QA Scorecard", reviewDate: "Mar 26", callDate: "Mar 24", score: 90.8 },
    { form: "Billing QA Scorecard", reviewDate: "Mar 22", callDate: "Mar 20", score: 87.1 },
    { form: "Billing QA Scorecard", reviewDate: "Mar 18", callDate: "Mar 16", score: 89.3 },
    { form: "Billing QA Scorecard", reviewDate: "Mar 14", callDate: "Mar 12", score: 86.5 },
    { form: "Billing QA Scorecard", reviewDate: "Mar 10", callDate: "Mar 8", score: 90.6 },
  ],
  "Maria Santos": [
    { form: "Tech Support QA v2", reviewDate: "Apr 4", callDate: "Apr 2", score: 78.2 },
    { form: "Tech Support QA v2", reviewDate: "Apr 1", callDate: "Mar 30", score: 82.1 },
    { form: "Tech Support QA v2", reviewDate: "Mar 28", callDate: "Mar 26", score: 74.5 },
    { form: "Tech Support QA v2", reviewDate: "Mar 24", callDate: "Mar 22", score: 81.3 },
    { form: "Tech Support QA v2", reviewDate: "Mar 20", callDate: "Mar 18", score: 76.8 },
    { form: "Tech Support QA v2", reviewDate: "Mar 16", callDate: "Mar 14", score: 79.9 },
    { form: "Tech Support QA v2", reviewDate: "Mar 12", callDate: "Mar 10", score: 72.4 },
    { form: "Tech Support QA v2", reviewDate: "Mar 8", callDate: "Mar 6", score: 83.2 },
    { form: "Tech Support QA v2", reviewDate: "Mar 4", callDate: "Mar 2", score: 77.5 },
    { form: "Tech Support QA v2", reviewDate: "Mar 1", callDate: "Feb 27", score: 87.1 },
  ],
  "David Kim": [
    { form: "Tech Support QA v2", reviewDate: "Apr 3", callDate: "Apr 1", score: 91.4 },
    { form: "Tech Support QA v2", reviewDate: "Mar 30", callDate: "Mar 28", score: 88.7 },
    { form: "Tech Support QA v2", reviewDate: "Mar 26", callDate: "Mar 24", score: 86.2 },
    { form: "Tech Support QA v2", reviewDate: "Mar 22", callDate: "Mar 20", score: 89.5 },
    { form: "Tech Support QA v2", reviewDate: "Mar 18", callDate: "Mar 16", score: 84.8 },
    { form: "Tech Support QA v2", reviewDate: "Mar 14", callDate: "Mar 12", score: 90.1 },
    { form: "Tech Support QA v2", reviewDate: "Mar 10", callDate: "Mar 8", score: 85.3 },
    { form: "Tech Support QA v2", reviewDate: "Mar 6", callDate: "Mar 4", score: 87.9 },
    { form: "Tech Support QA v2", reviewDate: "Mar 2", callDate: "Feb 28", score: 88.0 },
  ],
  "Lisa Thompson": [
    { form: "Enterprise Evaluation", reviewDate: "Apr 2", callDate: "Mar 31", score: 95.8 },
    { form: "Enterprise Evaluation", reviewDate: "Mar 28", callDate: "Mar 26", score: 92.1 },
    { form: "Enterprise Evaluation", reviewDate: "Mar 22", callDate: "Mar 20", score: 94.5 },
    { form: "Enterprise Evaluation", reviewDate: "Mar 16", callDate: "Mar 14", score: 91.7 },
    { form: "Enterprise Evaluation", reviewDate: "Mar 10", callDate: "Mar 8", score: 93.9 },
    { form: "Enterprise Evaluation", reviewDate: "Mar 4", callDate: "Mar 2", score: 93.0 },
  ],
  "Robert Chen": [
    { form: "Enterprise Evaluation", reviewDate: "Apr 3", callDate: "Apr 1", score: 84.5 },
    { form: "Enterprise Evaluation", reviewDate: "Mar 29", callDate: "Mar 27", score: 88.2 },
    { form: "Enterprise Evaluation", reviewDate: "Mar 24", callDate: "Mar 22", score: 85.9 },
    { form: "Enterprise Evaluation", reviewDate: "Mar 18", callDate: "Mar 16", score: 87.1 },
    { form: "Enterprise Evaluation", reviewDate: "Mar 12", callDate: "Mar 10", score: 83.8 },
    { form: "Enterprise Evaluation", reviewDate: "Mar 6", callDate: "Mar 4", score: 89.4 },
    { form: "Enterprise Evaluation", reviewDate: "Mar 1", callDate: "Feb 27", score: 84.5 },
  ],
  "Ashley Brown": [
    { form: "Installs Quality Check", reviewDate: "Apr 4", callDate: "Apr 2", score: 72.3 },
    { form: "Installs Quality Check", reviewDate: "Apr 1", callDate: "Mar 30", score: 78.1 },
    { form: "Installs Quality Check", reviewDate: "Mar 27", callDate: "Mar 25", score: 69.5 },
    { form: "Installs Quality Check", reviewDate: "Mar 23", callDate: "Mar 21", score: 80.2 },
    { form: "Installs Quality Check", reviewDate: "Mar 19", callDate: "Mar 17", score: 74.8 },
    { form: "Installs Quality Check", reviewDate: "Mar 15", callDate: "Mar 13", score: 77.6 },
    { form: "Installs Quality Check", reviewDate: "Mar 11", callDate: "Mar 9", score: 81.4 },
    { form: "Installs Quality Check", reviewDate: "Mar 7", callDate: "Mar 5", score: 77.3 },
  ],
  "Michael Davis": [
    { form: "Installs Quality Check", reviewDate: "Apr 3", callDate: "Apr 1", score: 87.2 },
    { form: "Installs Quality Check", reviewDate: "Mar 29", callDate: "Mar 27", score: 84.5 },
    { form: "Installs Quality Check", reviewDate: "Mar 24", callDate: "Mar 22", score: 86.8 },
    { form: "Installs Quality Check", reviewDate: "Mar 19", callDate: "Mar 17", score: 83.1 },
    { form: "Installs Quality Check", reviewDate: "Mar 14", callDate: "Mar 12", score: 88.5 },
    { form: "Installs Quality Check", reviewDate: "Mar 9", callDate: "Mar 7", score: 85.2 },
    { form: "Installs Quality Check", reviewDate: "Mar 4", callDate: "Mar 2", score: 85.3 },
  ],
  "Jennifer White": [
    { form: "Tech/Shipping QA v1", reviewDate: "Apr 2", callDate: "Mar 31", score: 91.8 },
    { form: "Tech/Shipping QA v1", reviewDate: "Mar 26", callDate: "Mar 24", score: 89.4 },
    { form: "Tech/Shipping QA v1", reviewDate: "Mar 18", callDate: "Mar 16", score: 90.2 },
    { form: "Tech/Shipping QA v1", reviewDate: "Mar 10", callDate: "Mar 8", score: 88.7 },
    { form: "Tech/Shipping QA v1", reviewDate: "Mar 3", callDate: "Mar 1", score: 90.4 },
  ],
  "Chris Johnson": [
    { form: "Tech/Shipping QA v1", reviewDate: "Apr 3", callDate: "Apr 1", score: 82.1 },
    { form: "Tech/Shipping QA v1", reviewDate: "Mar 28", callDate: "Mar 26", score: 85.4 },
    { form: "Tech/Shipping QA v1", reviewDate: "Mar 22", callDate: "Mar 20", score: 79.8 },
    { form: "Tech/Shipping QA v1", reviewDate: "Mar 16", callDate: "Mar 14", score: 86.2 },
    { form: "Tech/Shipping QA v1", reviewDate: "Mar 10", callDate: "Mar 8", score: 83.9 },
    { form: "Tech/Shipping QA v1", reviewDate: "Mar 4", callDate: "Mar 2", score: 83.6 },
  ],
};

// ─── AGENT QUIZ DETAILS (for Agent Profile quiz drill-down) ───
const agentQuizDetails = {
  "Sarah Mitchell": [
    { quiz: "Billing Procedures 2025", score: 92, passed: true, attempts: 1, date: "Mar 15" },
    { quiz: "Compliance Basics", score: 95, passed: true, attempts: 1, date: "Mar 22" },
  ],
  "James Cooper": [
    { quiz: "Billing Procedures 2025", score: 81, passed: true, attempts: 1, date: "Mar 14" },
    { quiz: "Upsell Techniques", score: 58, passed: false, attempts: 2, date: "Mar 28" },
    { quiz: "Compliance Basics", score: 88, passed: true, attempts: 1, date: "Apr 1" },
  ],
  "Maria Santos": [
    { quiz: "Product Knowledge v3", score: 52, passed: false, attempts: 2, date: "Mar 10" },
    { quiz: "Troubleshooting Fundamentals", score: 61, passed: false, attempts: 2, date: "Mar 20" },
    { quiz: "Customer Empathy & De-escalation", score: 74, passed: true, attempts: 2, date: "Apr 2" },
  ],
  "David Kim": [
    { quiz: "Troubleshooting Fundamentals", score: 85, passed: true, attempts: 1, date: "Mar 18" },
    { quiz: "Product Knowledge v3", score: 78, passed: true, attempts: 2, date: "Mar 30" },
  ],
  "Lisa Thompson": [
    { quiz: "Compliance Basics", score: 96, passed: true, attempts: 1, date: "Mar 12" },
    { quiz: "New Hire Orientation", score: 91, passed: true, attempts: 1, date: "Feb 28" },
  ],
  "Robert Chen": [
    { quiz: "Product Knowledge v3", score: 72, passed: true, attempts: 2, date: "Mar 25" },
    { quiz: "Compliance Basics", score: 85, passed: true, attempts: 1, date: "Apr 3" },
  ],
  "Ashley Brown": [
    { quiz: "Product Knowledge v3", score: 45, passed: false, attempts: 3, date: "Mar 8" },
    { quiz: "Troubleshooting Fundamentals", score: 55, passed: false, attempts: 2, date: "Mar 18" },
    { quiz: "Upsell Techniques", score: 51, passed: false, attempts: 2, date: "Mar 29" },
  ],
  "Michael Davis": [
    { quiz: "Product Knowledge v3", score: 62, passed: false, attempts: 2, date: "Mar 15" },
    { quiz: "Upsell Techniques", score: 57, passed: false, attempts: 2, date: "Mar 26" },
    { quiz: "New Hire Orientation", score: 82, passed: true, attempts: 1, date: "Apr 1" },
  ],
  "Jennifer White": [
    { quiz: "Compliance Basics", score: 93, passed: true, attempts: 1, date: "Mar 20" },
    { quiz: "Customer Empathy & De-escalation", score: 88, passed: true, attempts: 1, date: "Apr 1" },
  ],
  "Chris Johnson": [
    { quiz: "Product Knowledge v3", score: 59, passed: false, attempts: 2, date: "Mar 12" },
    { quiz: "Customer Empathy & De-escalation", score: 68, passed: false, attempts: 2, date: "Mar 28" },
    { quiz: "Compliance Basics", score: 80, passed: true, attempts: 1, date: "Apr 3" },
  ],
};

// ─── AGENT COACHING SESSIONS (for Agent Profile coaching drill-down) ───
// Each entry = one coaching session with date and topics covered
const agentCoachingSessions = {
  "Sarah Mitchell": [
    { date: "Apr 2", topics: ["Upsell/Retention Offers"], status: "COMPLETED" },
    { date: "Mar 20", topics: ["Call Opening & Greeting"], status: "COMPLETED" },
  ],
  "James Cooper": [
    { date: "Apr 2", topics: ["Upsell/Retention Offers"], status: "COMPLETED" },
    { date: "Mar 25", topics: ["Upsell/Retention Offers", "Call Opening & Greeting"], status: "COMPLETED" },
    { date: "Mar 12", topics: ["Upsell/Retention Offers"], status: "COMPLETED" },
  ],
  "Maria Santos": [
    { date: "Apr 4", topics: ["Troubleshooting Process"], status: "COMPLETED" },
    { date: "Mar 31", topics: ["Upsell/Retention Offers", "Troubleshooting Process"], status: "COMPLETED" },
    { date: "Mar 22", topics: ["Call Opening & Greeting", "Troubleshooting Process"], status: "COMPLETED" },
    { date: "Mar 14", topics: ["Call Opening & Greeting", "Troubleshooting Process"], status: "COMPLETED" },
    { date: "Mar 5", topics: ["Call Opening & Greeting"], status: "COMPLETED" },
    { date: "Mar 1", topics: ["Troubleshooting Process"], status: "PENDING" },
  ],
  "David Kim": [
    { date: "Apr 1", topics: ["Troubleshooting Process", "Technical Accuracy"], status: "COMPLETED" },
    { date: "Mar 18", topics: ["Troubleshooting Process"], status: "COMPLETED" },
    { date: "Mar 5", topics: ["Technical Accuracy"], status: "COMPLETED" },
  ],
  "Lisa Thompson": [],
  "Robert Chen": [
    { date: "Mar 28", topics: ["Customer Empathy"], status: "COMPLETED" },
    { date: "Mar 10", topics: ["Documentation & Notes"], status: "COMPLETED" },
  ],
  "Ashley Brown": [
    { date: "Mar 29", topics: ["Troubleshooting Process", "Call Opening & Greeting"], status: "COMPLETED" },
    { date: "Mar 20", topics: ["Call Opening & Greeting", "Documentation & Notes"], status: "COMPLETED" },
    { date: "Mar 12", topics: ["Troubleshooting Process", "Call Opening & Greeting"], status: "COMPLETED" },
    { date: "Mar 5", topics: ["Troubleshooting Process"], status: "COMPLETED" },
    { date: "Feb 28", topics: ["Call Opening & Greeting"], status: "COMPLETED" },
  ],
  "Michael Davis": [
    { date: "Mar 30", topics: ["Upsell/Retention Offers"], status: "COMPLETED" },
    { date: "Mar 15", topics: ["Call Opening & Greeting"], status: "COMPLETED" },
  ],
  "Jennifer White": [
    { date: "Mar 22", topics: ["Documentation & Notes"], status: "COMPLETED" },
  ],
  "Chris Johnson": [
    { date: "Mar 26", topics: ["Troubleshooting Process", "Call Opening & Greeting"], status: "COMPLETED" },
    { date: "Mar 15", topics: ["Upsell/Retention Offers", "Call Opening & Greeting"], status: "COMPLETED" },
    { date: "Mar 5", topics: ["Call Opening & Greeting"], status: "COMPLETED" },
  ],
};

const writeUpMockData = [
  { name: "Ashley Brown", dept: "Installs", type: "WRITTEN_WARNING", status: "FOLLOW_UP_PENDING", created: "Mar 10", meetingDate: "Mar 15", followUpDate: "Apr 15", manager: "Tom Richards", qa: 76.4, priorCount: 1, linkedCoaching: true, policies: ["Attendance Policy", "Customer Communication Standards"] },
  { name: "Maria Santos", dept: "Tech Support", type: "VERBAL_WARNING", status: "DELIVERED", created: "Mar 22", meetingDate: "Mar 25", followUpDate: "Apr 22", manager: "Linda Park", qa: 79.3, priorCount: 0, linkedCoaching: true, policies: ["Troubleshooting SOP", "Quality Standards"] },
  { name: "Chris Johnson", dept: "Tech/Shipping", type: "VERBAL_WARNING", status: "CLOSED", created: "Feb 14", meetingDate: "Feb 18", followUpDate: null, manager: "Tom Richards", qa: 83.5, priorCount: 0, linkedCoaching: true, policies: ["Documentation Requirements"] },
  { name: "David Kim", dept: "Tech Support", type: "FINAL_WARNING", status: "AWAITING_SIGNATURE", created: "Apr 1", meetingDate: "Apr 3", followUpDate: "May 1", manager: "Linda Park", qa: 88.1, priorCount: 2, linkedCoaching: false, policies: ["Attendance Policy", "Code of Conduct"] },
  { name: "Robert Chen", dept: "Enterprise Accounts", type: "VERBAL_WARNING", status: "SIGNED", created: "Mar 5", meetingDate: "Mar 8", followUpDate: "Apr 5", manager: "Sarah Williams", qa: 86.2, priorCount: 0, linkedCoaching: true, policies: ["Customer Communication Standards"] },
  { name: "James Cooper", dept: "Billing", type: "WRITTEN_WARNING", status: "DRAFT", created: "Apr 4", meetingDate: null, followUpDate: null, manager: "Tom Richards", qa: 88.7, priorCount: 1, linkedCoaching: false, policies: ["Billing Accuracy Policy"] },
];

// ─── AGENTS WHO MISSED QUESTION (drill-down mock) ───
const agentsMissedQuestion = {
  "Proper Opening Greeting": [
    { name: "Maria Santos", dept: "Tech Support", score: 0, qa: 79.3 },
    { name: "Ashley Brown", dept: "Installs", score: 0, qa: 76.4 },
    { name: "Chris Johnson", dept: "Tech/Shipping", score: 0, qa: 83.5 },
    { name: "James Cooper", dept: "Billing", score: 50, qa: 88.7 },
    { name: "Michael Davis", dept: "Installs", score: 25, qa: 85.8 },
  ],
  "Upsell/Retention Offer": [
    { name: "James Cooper", dept: "Billing", score: 0, qa: 88.7 },
    { name: "Maria Santos", dept: "Tech Support", score: 0, qa: 79.3 },
    { name: "Chris Johnson", dept: "Tech/Shipping", score: 25, qa: 83.5 },
  ],
  "Pre-Install Communication": [
    { name: "Ashley Brown", dept: "Installs", score: 0, qa: 76.4 },
    { name: "Michael Davis", dept: "Installs", score: 0, qa: 85.8 },
  ],
  "Troubleshooting Process": [
    { name: "Maria Santos", dept: "Tech Support", score: 0, qa: 79.3 },
    { name: "David Kim", dept: "Tech Support", score: 25, qa: 88.1 },
    { name: "Chris Johnson", dept: "Tech/Shipping", score: 0, qa: 83.5 },
    { name: "Ashley Brown", dept: "Installs", score: 0, qa: 76.4 },
  ],
  "Resolution Verification": [
    { name: "Maria Santos", dept: "Tech Support", score: 0, qa: 79.3 },
    { name: "Ashley Brown", dept: "Installs", score: 0, qa: 76.4 },
    { name: "Robert Chen", dept: "Enterprise Accounts", score: 25, qa: 86.2 },
  ],
};

// ─── HELPERS ───
const fmtVal = (k, v) => { const d = KPI_DEFS[k]; if (!d) return v; return d.fmt === "PCT" ? `${v}%` : v; };

const getColor = (k, v) => {
  const d = KPI_DEFS[k]; if (!d || !d.goal) return TEXT;
  if (d.dir === "UP") return v >= d.goal ? GREEN : v >= (d.warn||0) ? ORANGE : RED;
  if (d.dir === "DOWN") return v <= d.goal ? GREEN : v <= (d.warn||999) ? ORANGE : RED;
  return TEXT;
};

const Dot = ({ k, v }) => { const c = getColor(k, v); return <span style={{ display:"inline-block", width:8, height:8, borderRadius:"50%", background:c, marginRight:6 }} />; };

const Tip = ({ k, children }) => {
  const [s, setS] = useState(false);
  const d = KPI_DEFS[k]; if (!d) return children;
  return (
    <span style={{ position:"relative", cursor:"help" }} onMouseEnter={() => setS(true)} onMouseLeave={() => setS(false)}>
      {children}
      {s && <div style={{ position:"absolute", bottom:"100%", left:0, marginBottom:8, background:TEXT, color:"#fff", padding:"12px 16px", borderRadius:8, fontSize:12, lineHeight:1.5, width:380, zIndex:1000, boxShadow:"0 4px 12px rgba(0,0,0,.3)" }}>
        <div style={{ fontWeight:700, fontSize:13, marginBottom:4 }}>{d.name}</div>
        <div style={{ marginBottom:6, opacity:.9 }}>{d.desc}</div>
        {d.formula && <div style={{ background:"rgba(255,255,255,.1)", padding:"6px 8px", borderRadius:4, marginBottom:6, fontSize:11, fontFamily:"'SF Mono',Consolas,monospace", lineHeight:1.4, wordBreak:"break-word" }}>
          <span style={{ opacity:.6, fontSize:10 }}>Formula: </span>{d.formula}
        </div>}
        {d.schema_note && <div style={{ background:"rgba(249,115,22,.2)", padding:"4px 8px", borderRadius:4, marginBottom:6, fontSize:11 }}>Schema: {d.schema_note}</div>}
        <div style={{ borderTop:"1px solid rgba(255,255,255,.2)", paddingTop:6, display:"grid", gridTemplateColumns:"1fr 1fr", gap:4, fontSize:11 }}>
          <span style={{ opacity:.7 }}>Source:</span><span>{d.src}</span>
          <span style={{ opacity:.7 }}>Benchmark:</span><span>{d.bench}</span>
          {d.goal != null && <><span style={{ opacity:.7 }}>Goal:</span><span style={{ color:"#86efac" }}>{d.goal}{d.fmt==="PCT"?"%":""}</span></>}
          {d.warn != null && <><span style={{ opacity:.7 }}>Warning:</span><span style={{ color:"#fde047" }}>{d.warn}{d.fmt==="PCT"?"%":""}</span></>}
          {d.crit != null && <><span style={{ opacity:.7 }}>Critical:</span><span style={{ color:"#fca5a5" }}>{d.crit}{d.fmt==="PCT"?"%":""}</span></>}
        </div>
      </div>}
    </span>
  );
};

const Tile = ({ k, v, onClick, sm, pv }) => {
  const d = KPI_DEFS[k]; if (!d) return null;
  // Period-over-period delta: pv = prior period value
  const delta = (pv != null && v != null) ? +(v - pv).toFixed(1) : null;
  const deltaGood = d.dir === "UP" ? delta > 0 : d.dir === "DOWN" ? delta < 0 : null;
  return (
    <div onClick={onClick} style={{ background:CARD, border:`1px solid ${BORDER}`, borderRadius:10, padding:sm?"12px 16px":"16px 20px", cursor:onClick?"pointer":"default", transition:"all .15s", boxShadow:"0 1px 3px rgba(0,0,0,.04)" }}
      onMouseOver={e => { if(onClick) { e.currentTarget.style.borderColor=BRAND; e.currentTarget.style.boxShadow=`0 2px 8px rgba(0,174,239,.15)`; }}}
      onMouseOut={e => { e.currentTarget.style.borderColor=BORDER; e.currentTarget.style.boxShadow="0 1px 3px rgba(0,0,0,.04)"; }}>
      <Tip k={k}><div style={{ fontSize:12, color:TEXT_SUB, marginBottom:4, display:"flex", alignItems:"center" }}><Dot k={k} v={v} />{d.name} <span style={{ marginLeft:4, opacity:.5, fontSize:10 }}>ⓘ</span></div></Tip>
      <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
        <div style={{ fontSize:sm?22:28, fontWeight:700, color:TEXT }}>{fmtVal(k, v)}</div>
        {delta != null && delta !== 0 && <span style={{ fontSize:11, fontWeight:600, color: deltaGood === true ? GREEN : deltaGood === false ? RED : TEXT_SUB }}>
          {delta > 0 ? "▲" : "▼"} {Math.abs(delta)}{d.fmt==="PCT"?"%":""}
        </span>}
        {delta != null && delta === 0 && <span style={{ fontSize:11, fontWeight:500, color:TEXT_SUB }}>— flat</span>}
      </div>
      {d.goal != null && <div style={{ fontSize:11, color:TEXT_SUB, marginTop:2 }}>Goal: {d.goal}{d.fmt==="PCT"?"%":""}</div>}
      {delta != null && <div style={{ fontSize:10, color:TEXT_SUB, marginTop:1 }}>vs prior period</div>}
    </div>
  );
};

const Chart = ({ data, dk, color, h=80, gv, label }) => {
  const [hover, setHover] = useState(null);
  const vals = data.map(d => d[dk]);
  const max = Math.max(...vals, gv||0) * 1.05;
  const min = Math.min(...vals, gv||100) * 0.95;
  const rng = max - min || 1;
  const w = 280;
  const padL = 35;
  const padR = 10;
  const chartW = w - padL - padR;
  const pts = data.map((d, i) => `${padL + (i/(data.length-1))*chartW},${h-((d[dk]-min)/rng)*h}`).join(" ");
  const gy = gv != null ? h-((gv-min)/rng)*h : null;
  return (
    <div style={{ position:"relative" }}>
      {label && <div style={{ fontSize:11, fontWeight:600, color, marginBottom:6 }}>● {label}</div>}
      <svg width={w} height={h+24} style={{ overflow:"visible", display:"block", margin:"0 auto" }}>
        {/* Y-axis labels */}
        <text x={padL-4} y={8} textAnchor="end" fontSize={9} fill={TEXT_SUB}>{Math.round(max)}</text>
        <text x={padL-4} y={h} textAnchor="end" fontSize={9} fill={TEXT_SUB}>{Math.round(min)}</text>
        {/* Goal line */}
        {gy !== null && <>
          <line x1={padL} y1={gy} x2={padL+chartW} y2={gy} stroke={GREEN} strokeWidth={1} strokeDasharray="4 3" />
          <text x={padL+chartW+4} y={gy+3} fontSize={9} fill={GREEN}>Goal {gv}</text>
        </>}
        {/* Grid lines */}
        <line x1={padL} y1={0} x2={padL} y2={h} stroke={BORDER} strokeWidth={0.5} />
        <line x1={padL} y1={h} x2={padL+chartW} y2={h} stroke={BORDER} strokeWidth={0.5} />
        {/* Line */}
        <polyline points={pts} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" />
        {/* Data points + hover zones */}
        {data.map((d, i) => {
          const cx = padL + (i/(data.length-1))*chartW;
          const cy = h-((d[dk]-min)/rng)*h;
          const isHovered = hover === i;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {/* Invisible wider hit zone */}
              <rect x={cx-16} y={0} width={32} height={h+20} fill="transparent" />
              <circle cx={cx} cy={cy} r={isHovered ? 5 : 3} fill={isHovered ? color : CARD} stroke={color} strokeWidth={2} />
              {/* Hover tooltip */}
              {isHovered && <>
                <line x1={cx} y1={0} x2={cx} y2={h} stroke={color} strokeWidth={0.5} strokeDasharray="2 2" opacity={0.4} />
                <rect x={cx-24} y={cy-28} width={48} height={20} rx={4} fill={TEXT} />
                <text x={cx} y={cy-15} textAnchor="middle" fontSize={11} fontWeight="600" fill="#fff">
                  {d[dk]}{dk !== "cad" ? "%" : "%"}
                </text>
              </>}
              {/* X-axis label */}
              <text x={cx} y={h+16} textAnchor="middle" fontSize={10} fill={isHovered ? TEXT : TEXT_SUB} fontWeight={isHovered ? 600 : 400}>{d.m}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};

const Stat = ({ label, value, color }) => (
  <div style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:`1px solid ${BORDER}`, fontSize:12 }}>
    <span style={{ color:TEXT_SUB }}>{label}</span><span style={{ fontWeight:600, color:color||TEXT }}>{value}</span>
  </div>
);

const Badge = ({ val, good }) => (
  <span style={{ background:good?GREEN_LIGHT:RED_LIGHT, color:good?GREEN:RED, padding:"2px 10px", borderRadius:4, fontSize:11, fontWeight:600 }}>{val}</span>
);

const Section = ({ title, children }) => (
  <div style={{ background:CARD, border:`1px solid ${BORDER}`, borderRadius:10, padding:20, marginBottom:16 }}>
    <div style={{ fontSize:14, fontWeight:600, marginBottom:14 }}>{title}</div>
    {children}
  </div>
);

// ─── BELL CURVE COMPONENT ───
const BellCurve = ({ selectedForms }) => {
  // Merge distributions from all selected forms
  const merged = useMemo(() => {
    const forms = selectedForms.length === 0 ? ["All Forms"] : selectedForms;
    const buckets = scoreDistributions["All Forms"].map(b => ({ range: b.range, count: 0 }));
    forms.forEach(f => {
      const dist = scoreDistributions[f] || scoreDistributions["All Forms"];
      dist.forEach((b, i) => { buckets[i].count += b.count; });
    });
    return buckets;
  }, [selectedForms]);

  const maxCount = Math.max(...merged.map(b => b.count));
  const w = 500, h = 180, pad = 40, barGap = 4;
  const barW = (w - pad * 2) / merged.length - barGap;
  const total = merged.reduce((s, b) => s + b.count, 0);
  // Threshold line at 85% (index 6 = "85-89" bucket, draw between 80-84 and 85-89)
  const threshX = pad + (4.5 * (barW + barGap)); // between 75-79 and 80-84 area

  return (
    <svg width={w} height={h + 30} style={{ overflow: "visible" }}>
      {/* Y axis labels */}
      {[0, Math.round(maxCount / 2), maxCount].map((v, i) => {
        const y = h - (v / maxCount) * (h - 20);
        return <text key={i} x={pad - 6} y={y + 4} textAnchor="end" fontSize={10} fill={TEXT_SUB}>{v}</text>;
      })}
      {/* Bars */}
      {merged.map((b, i) => {
        const bh = maxCount > 0 ? (b.count / maxCount) * (h - 20) : 0;
        const x = pad + i * (barW + barGap);
        const y = h - bh;
        const isBelow = i < 5; // Below 80%
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={bh} rx={3} fill={isBelow ? `${RED}40` : `${BRAND}60`} stroke={isBelow ? RED : BRAND} strokeWidth={1} />
            <text x={x + barW / 2} y={h + 14} textAnchor="middle" fontSize={9} fill={TEXT_SUB}>{b.range}</text>
            {b.count > 0 && <text x={x + barW / 2} y={y - 4} textAnchor="middle" fontSize={9} fill={TEXT_SUB}>{b.count}</text>}
          </g>
        );
      })}
      {/* Threshold line at 80% mark */}
      <line x1={threshX} y1={0} x2={threshX} y2={h} stroke={RED} strokeWidth={1.5} strokeDasharray="5 3" />
      <text x={threshX + 4} y={12} fontSize={10} fill={RED} fontWeight={600}>80% Threshold</text>
      {/* Stats */}
      <text x={pad} y={h + 28} fontSize={10} fill={TEXT_SUB}>{total} evaluations · Avg: {selectedForms.length <= 1 ? "87.3%" : "—"} · Median: {selectedForms.length <= 1 ? "88.1%" : "—"}</text>
    </svg>
  );
};

// ─── MULTI-SELECT FORM PICKER COMPONENT ───
const MultiFormSelect = ({ selected, onChange, forms }) => {
  const [open, setOpen] = useState(false);
  const toggle = (f) => {
    if (selected.includes(f)) onChange(selected.filter(x => x !== f));
    else onChange([...selected, f]);
  };
  const label = selected.length === 0 ? "All Forms" : selected.length === 1 ? selected[0] : `${selected.length} forms selected`;
  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <div onClick={() => setOpen(!open)} style={{ padding: "8px 12px", borderRadius: 6, border: `1px solid ${open ? BRAND : BORDER}`, fontSize: 13, background: CARD, cursor: "pointer", minWidth: 200, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>{label}</span>
        <span style={{ fontSize: 10, color: TEXT_SUB, marginLeft: 8 }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 4, background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, boxShadow: "0 4px 12px rgba(0,0,0,.1)", zIndex: 100, minWidth: 240, padding: "4px 0" }}>
          {selected.length > 0 && (
            <div onClick={() => { onChange([]); }} style={{ padding: "8px 12px", fontSize: 12, cursor: "pointer", color: BRAND, borderBottom: `1px solid ${BORDER}` }}
              onMouseOver={e => e.currentTarget.style.background = BLUE_LIGHT} onMouseOut={e => e.currentTarget.style.background = "transparent"}>
              ✓ Clear all (show All Forms)
            </div>
          )}
          {forms.filter(f => f !== "All Forms").map(f => (
            <div key={f} onClick={() => toggle(f)} style={{ padding: "8px 12px", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}
              onMouseOver={e => e.currentTarget.style.background = BLUE_LIGHT} onMouseOut={e => e.currentTarget.style.background = "transparent"}>
              <span style={{ width: 16, height: 16, borderRadius: 3, border: `1.5px solid ${selected.includes(f) ? BRAND : BORDER}`, background: selected.includes(f) ? BRAND : "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 11, fontWeight: 700 }}>
                {selected.includes(f) ? "✓" : ""}
              </span>
              {f}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── VIEWS ───
const V = { DASH:"dash", QUALITY:"quality", TRAINING:"training", COACHING:"coaching", AGENTS:"agents", AGENT:"agent" };

// ─── MULTI-SELECT DROPDOWN (reusable) ───
const MultiSelect = ({ label, options, selected, onChange, allLabel }) => {
  const [open, setOpen] = useState(false);
  const toggle = (val) => {
    if (selected.includes(val)) onChange(selected.filter(x => x !== val));
    else onChange([...selected, val]);
  };
  const display = selected.length === 0 ? (allLabel || "All") : selected.length === 1 ? selected[0] : `${selected.length} selected`;
  return (
    <div style={{ position:"relative", display:"inline-block" }}>
      <div onClick={() => setOpen(!open)} style={{ padding:"8px 12px", borderRadius:6, border:`1px solid ${open ? BRAND : BORDER}`, fontSize:13, background:CARD, cursor:"pointer", minWidth:180, display:"flex", justifyContent:"space-between", alignItems:"center", gap:8 }}>
        <span style={{ fontSize:11, color:TEXT_SUB, fontWeight:500 }}>{label}:</span>
        <span style={{ fontWeight:500 }}>{display}</span>
        <span style={{ fontSize:10, color:TEXT_SUB }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div style={{ position:"absolute", top:"100%", left:0, marginTop:4, background:CARD, border:`1px solid ${BORDER}`, borderRadius:8, boxShadow:"0 4px 12px rgba(0,0,0,.12)", zIndex:200, minWidth:220, padding:"4px 0", maxHeight:280, overflowY:"auto" }}>
          {selected.length > 0 && (
            <div onClick={() => { onChange([]); }} style={{ padding:"8px 12px", fontSize:12, cursor:"pointer", color:BRAND, borderBottom:`1px solid ${BORDER}` }}
              onMouseOver={e => e.currentTarget.style.background=BLUE_LIGHT} onMouseOut={e => e.currentTarget.style.background="transparent"}>
              ✓ Clear all ({allLabel || "show all"})
            </div>
          )}
          {options.map(o => (
            <div key={o} onClick={() => toggle(o)} style={{ padding:"8px 12px", fontSize:13, cursor:"pointer", display:"flex", alignItems:"center", gap:8 }}
              onMouseOver={e => e.currentTarget.style.background=BLUE_LIGHT} onMouseOut={e => e.currentTarget.style.background="transparent"}>
              <span style={{ width:16, height:16, borderRadius:3, border:`1.5px solid ${selected.includes(o)?BRAND:BORDER}`, background:selected.includes(o)?BRAND:"transparent", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:11, fontWeight:700, flexShrink:0 }}>
                {selected.includes(o) ? "✓" : ""}
              </span>
              {o}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default function InsightsMockupV3() {
  const [view, setView] = useState(V.DASH);
  const [selectedDepts, setSelectedDepts] = useState([]);  // empty = All Departments
  const [time, setTime] = useState("Current Month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [selectedForms, setSelectedForms] = useState([]);  // empty = All Forms
  const [agent, setAgent] = useState(null);
  const [bellForms, setBellForms] = useState([]);  // multi-select for bell curve / missed questions
  const [expandedQ, setExpandedQ] = useState(null); // for missed question drill-down
  const [expandedTopic, setExpandedTopic] = useState(null); // for coaching topic drill-down
  const [expandedRepeat, setExpandedRepeat] = useState(null); // for repeat offender topic drill-down
  const [expandedPolicy, setExpandedPolicy] = useState(null); // for most violated policies drill-down
  const [expandedAgentForm, setExpandedAgentForm] = useState(null); // for agent profile forms drill-down
  const [expandedAgentQuiz, setExpandedAgentQuiz] = useState(null); // for agent profile quiz drill-down

  // Derived state — for simplicity in the mockup, use first selected dept or "All Departments"
  const dept = selectedDepts.length === 1 ? selectedDepts[0] : "All Departments";
  const form = selectedForms.length === 1 ? selectedForms[0] : "All Forms";
  const d = D[dept] || D["All Departments"];
  const p = P[dept] || P["All Departments"];
  const agents = useMemo(() => {
    if (selectedDepts.length === 0) return mockAgents;
    return mockAgents.filter(a => selectedDepts.includes(a.dept));
  }, [selectedDepts]);
  const cats = formCategories[form] || formCategories["All Forms"];
  const timeDisplay = time === "Custom" && customStart && customEnd ? `${customStart} → ${customEnd}` : time;

  const nav = [
    { k:V.DASH, l:"Overview", i:"📊" },
    { k:V.QUALITY, l:"Quality Deep Dive", i:"🎯" },
    { k:V.TRAINING, l:"Coaching", i:"📚" },
    { k:V.COACHING, l:"Performance Warnings", i:"⚠️" },
    { k:V.AGENTS, l:"Agent Performance", i:"👤" },
  ];

  return (
    <div style={{ fontFamily:"'Inter',-apple-system,sans-serif", background:BG, minHeight:"100vh", color:TEXT }}>
      {/* TOP BAR */}
      <div style={{ background:CARD, borderBottom:`1px solid ${BORDER}`, padding:"12px 24px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ background:BRAND, color:"#fff", fontWeight:800, fontSize:14, padding:"6px 12px", borderRadius:6 }}>Qtip</div>
          <span style={{ fontSize:15, fontWeight:600 }}>Insights Engine</span>
          <span style={{ fontSize:12, color:TEXT_SUB, background:BLUE_LIGHT, padding:"2px 8px", borderRadius:4 }}>Quality & Coaching</span>
        </div>
        <div style={{ fontSize:11, color:TEXT_SUB }}>Data as of: April 5, 2026 2:00 AM · <span style={{ color:GREEN }}>● All systems healthy</span></div>
      </div>

      <div style={{ display:"flex" }}>
        {/* SIDEBAR */}
        <div style={{ width:210, background:CARD, borderRight:`1px solid ${BORDER}`, padding:"16px 0", minHeight:"calc(100vh - 50px)" }}>
          <div style={{ padding:"0 16px 12px", fontSize:11, fontWeight:600, color:TEXT_SUB, textTransform:"uppercase", letterSpacing:".05em" }}>Analytics</div>
          {nav.map(n => (
            <div key={n.k} onClick={() => { setView(n.k); setAgent(null); }}
              style={{ padding:"10px 16px", cursor:"pointer", fontSize:13, display:"flex", alignItems:"center", gap:8,
                background:view===n.k?BLUE_LIGHT:"transparent", color:view===n.k?BRAND_DARK:TEXT,
                fontWeight:view===n.k?600:400, borderRight:view===n.k?`3px solid ${BRAND}`:"3px solid transparent" }}
              onMouseOver={e => { if(view!==n.k) e.currentTarget.style.background="#f1f5f9"; }}
              onMouseOut={e => { if(view!==n.k) e.currentTarget.style.background="transparent"; }}>
              <span>{n.i}</span>{n.l}
            </div>
          ))}
          <div style={{ padding:"16px", marginTop:16, borderTop:`1px solid ${BORDER}` }}>
            <div style={{ fontSize:10, fontWeight:600, color:TEXT_SUB, textTransform:"uppercase", marginBottom:8 }}>KPI Count</div>
            <div style={{ fontSize:12, color:TEXT_SUB }}>
              <div>Quality: 12</div><div>Coaching: 8</div><div>Quiz: 3</div>
              <div>Discipline: 5</div>
              <div style={{ fontWeight:600, color:TEXT, marginTop:4, borderTop:`1px solid ${BORDER}`, paddingTop:4 }}>Total: 28 KPIs</div>
              <div style={{ fontSize:10, color:TEXT_SUB, marginTop:6 }}>+ Score Distribution</div>
              <div style={{ fontSize:10, color:TEXT_SUB }}>+ Top Missed Questions</div>
            </div>
          </div>
        </div>

        {/* MAIN */}
        <div style={{ flex:1, maxWidth:1200, height:"calc(100vh - 50px)", overflowY:"auto" }}>
          {/* STICKY FILTER BAR */}
          <div style={{ position:"sticky", top:0, zIndex:100, background:BG, borderBottom:`1px solid ${BORDER}`, padding:"12px 24px", display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
            <MultiSelect label="Department" options={DEPTS.filter(x => x !== "All Departments")} selected={selectedDepts} onChange={setSelectedDepts} allLabel="All Departments" />
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              <select value={time} onChange={e => setTime(e.target.value)} style={{ padding:"8px 12px", borderRadius:6, border:`1px solid ${BORDER}`, fontSize:13, background:CARD }}>
                {TIMES.map(x => <option key={x}>{x}</option>)}
              </select>
              {time === "Custom" && <>
                <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} style={{ padding:"7px 10px", borderRadius:6, border:`1px solid ${BORDER}`, fontSize:12, background:CARD }} />
                <span style={{ fontSize:12, color:TEXT_SUB }}>to</span>
                <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} style={{ padding:"7px 10px", borderRadius:6, border:`1px solid ${BORDER}`, fontSize:12, background:CARD }} />
              </>}
            </div>
            {(view === V.QUALITY || view === V.AGENT) && (
              <MultiSelect label="Form" options={FORMS.filter(x => x !== "All Forms")} selected={selectedForms} onChange={setSelectedForms} allLabel="All Forms" />
            )}
            {view !== V.DASH && <button onClick={() => setView(V.DASH)} style={{ marginLeft:"auto", padding:"8px 16px", borderRadius:6, border:`1px solid ${BORDER}`, background:CARD, fontSize:12, cursor:"pointer", color:TEXT_SUB }}>← Overview</button>}
          </div>

          <div style={{ padding:24 }}>

          {/* ═══ OVERVIEW DASHBOARD ═══ */}
          {view === V.DASH && <>
            <h2 style={{ fontSize:20, fontWeight:700, marginBottom:4 }}>Quality & Coaching Overview</h2>
            <p style={{ fontSize:13, color:TEXT_SUB, marginBottom:20 }}>{dept} · {timeDisplay} · Pace targets managed in Insights Engine Settings → KPI Thresholds</p>

            {/* ── ROW 1: QUALITY KPIs ── */}
            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:12, fontWeight:600, color:BRAND_DARK, marginBottom:8, display:"flex", alignItems:"center", gap:6, cursor:"pointer" }} onClick={() => setView(V.QUALITY)}>
                <span>🎯</span> Quality <span style={{ fontSize:10, color:TEXT_SUB, fontWeight:400 }}>— click to drill down</span>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:14 }}>
                <Tile k="audits_assigned" v={d.audits_assigned} pv={p.audits_assigned} sm onClick={() => setView(V.QUALITY)} />
                <Tile k="audits_completed" v={d.audits_completed} pv={p.audits_completed} sm onClick={() => setView(V.QUALITY)} />
                <Tile k="audit_completion_rate" v={d.audit_completion_rate} pv={p.audit_completion_rate} sm onClick={() => setView(V.QUALITY)} />
                <Tile k="avg_qa_score" v={d.avg_qa_score} pv={p.avg_qa_score} sm onClick={() => setView(V.QUALITY)} />
                <Tile k="critical_fail_rate" v={d.critical_fail_rate} pv={p.critical_fail_rate} sm onClick={() => setView(V.QUALITY)} />
              </div>
            </div>

            {/* ── ROW 2: COACHING KPIs ── */}
            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:12, fontWeight:600, color:PURPLE, marginBottom:8, display:"flex", alignItems:"center", gap:6, cursor:"pointer" }} onClick={() => setView(V.TRAINING)}>
                <span>📚</span> Coaching <span style={{ fontSize:10, color:TEXT_SUB, fontWeight:400 }}>— click to drill down</span>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14 }}>
                <Tile k="coaching_sessions_assigned" v={d.coaching_sessions_assigned} pv={p.coaching_sessions_assigned} sm onClick={() => setView(V.TRAINING)} />
                <Tile k="coaching_sessions_completed" v={d.coaching_sessions_completed} pv={p.coaching_sessions_completed} sm onClick={() => setView(V.TRAINING)} />
                <Tile k="coaching_completion_rate" v={d.coaching_completion_rate} pv={p.coaching_completion_rate} sm onClick={() => setView(V.TRAINING)} />
                <Tile k="quiz_pass_rate" v={d.quiz_pass_rate} pv={p.quiz_pass_rate} sm onClick={() => setView(V.TRAINING)} />
              </div>
            </div>

            {/* ── ROW 3: PERFORMANCE WARNINGS KPIs ── */}
            <div style={{ marginBottom:20 }}>
              <div style={{ fontSize:12, fontWeight:600, color:RED, marginBottom:8, display:"flex", alignItems:"center", gap:6, cursor:"pointer" }} onClick={() => setView(V.COACHING)}>
                <span>⚠️</span> Performance Warnings <span style={{ fontSize:10, color:TEXT_SUB, fontWeight:400 }}>— click to drill down</span>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:14 }}>
                <Tile k="total_writeups_issued" v={d.total_writeups_issued} pv={p.total_writeups_issued} sm onClick={() => setView(V.COACHING)} />
                <Tile k="escalation_rate" v={d.escalation_rate} pv={p.escalation_rate} sm onClick={() => setView(V.COACHING)} />
                <Tile k="repeat_offender_rate" v={d.repeat_offender_rate} pv={p.repeat_offender_rate} sm onClick={() => setView(V.COACHING)} />
              </div>
            </div>

            {/* ── TREND CHARTS ── */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:20 }}>
              <Section title="6-Month QA Trend">
                <Chart data={trendData} dk="qa" color={BRAND} h={100} gv={90} label="QA Score" />
              </Section>
              <Section title="6-Month Coaching Completion Trend">
                <Chart data={trendData} dk="co" color={PURPLE} h={100} gv={92} label="Coaching Completion" />
              </Section>
            </div>

            {/* ── TOP 5 / BOTTOM 5 LEADERBOARD ── */}
            <Section title="Agent Leaderboard">
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:24 }}>
                {/* BOTTOM 5 */}
                <div>
                  <div style={{ fontSize:12, fontWeight:600, color:RED, marginBottom:10, display:"flex", alignItems:"center", gap:6 }}>
                    <span style={{ background:RED_LIGHT, padding:"2px 8px", borderRadius:4 }}>▼ Bottom 5 — Needs Attention</span>
                  </div>
                  <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                    <thead><tr style={{ borderBottom:`2px solid ${BORDER}` }}>
                      {["#","Agent","Dept","QA","Trend","Cadence","Disputes","Write-Ups"].map(h => <th key={h} style={{ padding:"6px 8px", textAlign:"left", fontSize:10, fontWeight:600, color:TEXT_SUB }}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {[...agents].sort((a,b) => a.qa - b.qa).slice(0, 5).map((a, i) => (
                        <tr key={i} style={{ borderBottom:`1px solid ${BORDER}`, cursor:"pointer" }}
                          onClick={() => { setAgent(a); setView(V.AGENT); }}
                          onMouseOver={e => e.currentTarget.style.background=RED_LIGHT}
                          onMouseOut={e => e.currentTarget.style.background="transparent"}>
                          <td style={{ padding:"8px 8px", fontWeight:600, color:TEXT_SUB, width:24 }}>{i+1}</td>
                          <td style={{ padding:"8px 8px", fontWeight:500, color:BRAND_DARK }}>{a.name}</td>
                          <td style={{ padding:"8px 8px", color:TEXT_SUB, fontSize:11 }}>{a.dept}</td>
                          <td style={{ padding:"8px 8px", fontWeight:600, color:getColor("avg_qa_score", a.qa) }}>{a.qa}%</td>
                          <td style={{ padding:"8px 8px", color:a.trend.startsWith("+")?GREEN:RED, fontSize:11 }}>{a.trend}</td>
                          <td style={{ padding:"8px 8px", fontSize:11 }}><span style={{ color: a.cadence < a.expected ? ORANGE : GREEN, fontWeight:500 }}>{a.cadence}/{a.expected}</span></td>
                          <td style={{ padding:"8px 8px" }}>{a.disputes > 0 ? <span style={{ color:ORANGE, fontWeight:500 }}>{a.disputes}</span> : "0"}</td>
                          <td style={{ padding:"8px 8px" }}>{a.writeups > 0 ? <Badge val={a.writeups} /> : "0"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* TOP 5 */}
                <div>
                  <div style={{ fontSize:12, fontWeight:600, color:GREEN, marginBottom:10, display:"flex", alignItems:"center", gap:6 }}>
                    <span style={{ background:GREEN_LIGHT, padding:"2px 8px", borderRadius:4 }}>▲ Top 5 — Top Performers</span>
                  </div>
                  <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                    <thead><tr style={{ borderBottom:`2px solid ${BORDER}` }}>
                      {["#","Agent","Dept","QA","Trend","Cadence","Disputes","Write-Ups"].map(h => <th key={h} style={{ padding:"6px 8px", textAlign:"left", fontSize:10, fontWeight:600, color:TEXT_SUB }}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {[...agents].sort((a,b) => b.qa - a.qa).slice(0, 5).map((a, i) => (
                        <tr key={i} style={{ borderBottom:`1px solid ${BORDER}`, cursor:"pointer" }}
                          onClick={() => { setAgent(a); setView(V.AGENT); }}
                          onMouseOver={e => e.currentTarget.style.background=GREEN_LIGHT}
                          onMouseOut={e => e.currentTarget.style.background="transparent"}>
                          <td style={{ padding:"8px 8px", fontWeight:600, color:TEXT_SUB, width:24 }}>{i+1}</td>
                          <td style={{ padding:"8px 8px", fontWeight:500, color:BRAND_DARK }}>{a.name}</td>
                          <td style={{ padding:"8px 8px", color:TEXT_SUB, fontSize:11 }}>{a.dept}</td>
                          <td style={{ padding:"8px 8px", fontWeight:600, color:getColor("avg_qa_score", a.qa) }}>{a.qa}%</td>
                          <td style={{ padding:"8px 8px", color:a.trend.startsWith("+")?GREEN:RED, fontSize:11 }}>{a.trend}</td>
                          <td style={{ padding:"8px 8px", fontSize:11 }}><span style={{ color: a.cadence >= a.expected ? GREEN : ORANGE, fontWeight:500 }}>{a.cadence}/{a.expected}</span></td>
                          <td style={{ padding:"8px 8px" }}>{a.disputes > 0 ? <span style={{ color:ORANGE, fontWeight:500 }}>{a.disputes}</span> : "0"}</td>
                          <td style={{ padding:"8px 8px" }}>{a.writeups > 0 ? <Badge val={a.writeups} /> : "0"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div style={{ marginTop:12, textAlign:"center" }}>
                <span style={{ fontSize:12, color:BRAND, cursor:"pointer", fontWeight:500 }} onClick={() => setView(V.AGENTS)}>View full agent leaderboard →</span>
              </div>
            </Section>
          </>}

          {/* ═══ QUALITY DEEP DIVE ═══ */}
          {view === V.QUALITY && <>
            <h2 style={{ fontSize:20, fontWeight:700, marginBottom:4 }}>Quality Deep Dive</h2>
            <p style={{ fontSize:13, color:TEXT_SUB, marginBottom:20 }}>{dept} · {timeDisplay}{form !== "All Forms" ? ` · ${form}` : ""}</p>

            {/* ── ROW 1: Headline KPIs ── */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:16, marginBottom:20 }}>
              <Tile k="avg_qa_score" v={d.avg_qa_score} pv={p.avg_qa_score} />
              <Tile k="audits_assigned" v={d.audits_assigned} pv={p.audits_assigned} />
              <Tile k="audits_completed" v={d.audits_completed} pv={p.audits_completed} />
              <Tile k="audit_completion_rate" v={d.audit_completion_rate} pv={p.audit_completion_rate} />
              <Tile k="critical_fail_rate" v={d.critical_fail_rate} pv={p.critical_fail_rate} />
            </div>

            {/* ── ROW 2: QA Trend + Score Distribution (side by side) ── */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:20 }}>
              <Section title="QA Score Trend">
                <Chart data={trendData} dk="qa" color={BRAND} h={100} gv={90} label="QA Score" />
                <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginTop:12, borderTop:`1px solid ${BORDER}`, paddingTop:12 }}>
                  <div style={{ textAlign:"center" }}>
                    <div style={{ fontSize:10, color:TEXT_SUB }}>6mo Start</div>
                    <div style={{ fontSize:16, fontWeight:600 }}>{trendData[0].qa}%</div>
                  </div>
                  <div style={{ textAlign:"center" }}>
                    <div style={{ fontSize:10, color:TEXT_SUB }}>Current</div>
                    <div style={{ fontSize:16, fontWeight:600, color:BRAND }}>{trendData[trendData.length-1].qa}%</div>
                  </div>
                  <div style={{ textAlign:"center" }}>
                    <div style={{ fontSize:10, color:TEXT_SUB }}>Change</div>
                    <div style={{ fontSize:16, fontWeight:600, color: trendData[trendData.length-1].qa >= trendData[0].qa ? GREEN : RED }}>
                      {trendData[trendData.length-1].qa >= trendData[0].qa ? "+" : ""}{(trendData[trendData.length-1].qa - trendData[0].qa).toFixed(1)}
                    </div>
                  </div>
                  <div style={{ textAlign:"center" }}>
                    <div style={{ fontSize:10, color:TEXT_SUB }}>Peak</div>
                    <div style={{ fontSize:16, fontWeight:600, color:GREEN }}>{Math.max(...trendData.map(t=>t.qa))}%</div>
                  </div>
                </div>
              </Section>
              <Section title="Score Distribution">
                <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:12 }}>
                  <span style={{ fontSize:12, color:TEXT_SUB, fontWeight:500 }}>Filter by form(s):</span>
                  <MultiFormSelect selected={bellForms} onChange={setBellForms} forms={FORMS} />
                </div>
                <BellCurve selectedForms={bellForms} />
                <div style={{ marginTop:10, display:"flex", gap:16, fontSize:11 }}>
                  <span><span style={{ display:"inline-block", width:12, height:12, background:`${RED}40`, border:`1px solid ${RED}`, borderRadius:2, marginRight:4, verticalAlign:"middle" }} /> Below threshold</span>
                  <span><span style={{ display:"inline-block", width:12, height:12, background:`${BRAND}60`, border:`1px solid ${BRAND}`, borderRadius:2, marginRight:4, verticalAlign:"middle" }} /> At or above threshold</span>
                </div>
              </Section>
            </div>

            {/* ── ROW 3: Dispute Analysis + Timeliness ── */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:20 }}>
              <Section title="Dispute Analysis">
                <p style={{ fontSize:12, color:TEXT_SUB, marginBottom:12 }}>Assesses agent disputing behavior and auditor scoring accuracy.</p>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
                  <Tile k="dispute_rate" v={d.dispute_rate} sm />
                  <Tile k="dispute_adjusted_rate" v={d.dispute_adjusted_rate} sm />
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
                  <Tile k="dispute_not_upheld_rate" v={d.dispute_not_upheld_rate} sm />
                  <Tile k="avg_dispute_resolution_time" v={d.avg_dispute_resolution_time} sm />
                </div>
                <div style={{ marginTop:8 }}>
                  <Stat label="Open Disputes" value="4" color={ORANGE} />
                  <Stat label="Resolved This Period" value="12" />
                </div>
              </Section>

              <Section title="Timeliness">
                <Tile k="time_to_audit" v={d.time_to_audit} sm />
                <div style={{ marginTop:12 }}>
                  <Stat label="Audits completed same day" value="18%" />
                  <Stat label="Audits completed within 3 days" value="62%" />
                  <Stat label="Audits older than 7 days" value="8" color={RED} />
                </div>
              </Section>
            </div>

            {/* ── ROW 4: Score by Form ── */}
            <Section title={`Average Score by Form — ${dept}`}>
              <p style={{ fontSize:12, color:TEXT_SUB, marginBottom:12 }}>Only forms with evaluations in the selected period are shown. Click a form to filter by category below.</p>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                <thead><tr style={{ borderBottom:`2px solid ${BORDER}` }}>
                  {["Form","Avg Score","Evaluations","Goal","vs Goal","Trend"].map(h => <th key={h} style={{ padding:"8px 10px", textAlign:"left", fontSize:11, fontWeight:600, color:TEXT_SUB }}>{h}</th>)}
                </tr></thead>
                <tbody>{(scoreByForm[dept] || scoreByForm["All Departments"]).map((f, i) => (
                  <tr key={i} style={{ borderBottom:`1px solid ${BORDER}`, cursor:"pointer", background: form === f.form ? BLUE_LIGHT : "transparent" }}
                    onClick={() => setSelectedForms([f.form])}
                    onMouseOver={e => { if(form !== f.form) e.currentTarget.style.background=BLUE_LIGHT; }}
                    onMouseOut={e => { if(form !== f.form) e.currentTarget.style.background="transparent"; }}>
                    <td style={{ padding:"10px 10px", fontWeight:500, color: form === f.form ? BRAND_DARK : TEXT }}>{f.form}{form === f.form ? " ✓" : ""}</td>
                    <td style={{ padding:"10px 10px", fontWeight:600, color: f.avg >= f.goal ? GREEN : f.avg >= f.goal - 5 ? ORANGE : RED }}><Dot k="avg_qa_score" v={f.avg} />{f.avg}%</td>
                    <td style={{ padding:"10px 10px", color:TEXT_SUB }}>{f.evals}</td>
                    <td style={{ padding:"10px 10px", color:TEXT_SUB }}>{f.goal}%</td>
                    <td style={{ padding:"10px 10px" }}><Badge val={f.avg >= f.goal ? "Met" : `${(f.avg - f.goal).toFixed(1)}%`} good={f.avg >= f.goal} /></td>
                    <td style={{ padding:"10px 10px", color:f.trend.startsWith("+") ? GREEN : RED, fontWeight:500 }}>{f.trend}</td>
                  </tr>
                ))}</tbody>
              </table>
            </Section>

            {/* ── ROW 5: Score by Category (filtered by selected form) ── */}
            <Section title={`Score by Category — ${form}`}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                <thead><tr style={{ borderBottom:`2px solid ${BORDER}` }}>
                  {["Category","Form","Score","Goal","vs Goal","Trend"].map(h => <th key={h} style={{ padding:"6px 10px", textAlign:"left", fontSize:11, fontWeight:600, color:TEXT_SUB }}>{h}</th>)}
                </tr></thead>
                <tbody>{cats.map((c, i) => (
                  <tr key={i} style={{ borderBottom:`1px solid ${BORDER}` }}>
                    <td style={{ padding:"8px 10px", fontWeight:500 }}>{c.cat}</td>
                    <td style={{ padding:"8px 10px", fontSize:11, color:TEXT_SUB }}>{form === "All Forms" ? "All" : form}</td>
                    <td style={{ padding:"8px 10px", fontWeight:600 }}>{c.score}%</td>
                    <td style={{ padding:"8px 10px", color:TEXT_SUB }}>{c.goal}%</td>
                    <td style={{ padding:"8px 10px" }}><Badge val={c.score >= c.goal ? "Met" : `${(c.score - c.goal).toFixed(1)}%`} good={c.score >= c.goal} /></td>
                    <td style={{ padding:"8px 10px", color:c.trend.startsWith("+")?GREEN:RED, fontWeight:500 }}>{c.trend}</td>
                  </tr>
                ))}</tbody>
              </table>
            </Section>

            {/* ── ROW 6: Top Missed Questions with drill-down ── */}
            <Section title={`Top Missed Questions${bellForms.length === 1 ? ` — ${bellForms[0]}` : bellForms.length > 1 ? ` — ${bellForms.length} forms` : " — All Forms"}`}>
              <p style={{ fontSize:12, color:TEXT_SUB, marginBottom:12 }}>Click any question row to see which agents missed it.</p>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                <thead><tr style={{ borderBottom:`2px solid ${BORDER}` }}>
                  {["","Question","Form","Fail Rate","Evals","Trend","Most Common Miss"].map(h => <th key={h} style={{ padding:"8px 10px", textAlign:"left", fontSize:11, fontWeight:600, color:TEXT_SUB }}>{h}</th>)}
                </tr></thead>
                <tbody>{(() => {
                  const formKey = bellForms.length === 1 ? bellForms[0] : "All Forms";
                  const questions = topMissedQuestions[formKey] || topMissedQuestions["All Forms"];
                  return questions.slice(0, 8).map((q, i) => (
                    <React.Fragment key={i}>
                      <tr style={{ borderBottom: expandedQ === q.question ? "none" : `1px solid ${BORDER}`, cursor:"pointer", background: expandedQ === q.question ? BLUE_LIGHT : "transparent" }}
                        onClick={() => setExpandedQ(expandedQ === q.question ? null : q.question)}
                        onMouseOver={e => { if(expandedQ !== q.question) e.currentTarget.style.background=BLUE_LIGHT; }}
                        onMouseOut={e => { if(expandedQ !== q.question) e.currentTarget.style.background="transparent"; }}>
                        <td style={{ padding:"8px 10px", fontWeight:600, color:TEXT_SUB, width:30 }}>{expandedQ === q.question ? "▼" : "▶"}</td>
                        <td style={{ padding:"8px 10px", fontWeight:500 }}>{q.question}</td>
                        <td style={{ padding:"8px 10px", fontSize:12, color:TEXT_SUB }}>{q.form}</td>
                        <td style={{ padding:"8px 10px", fontWeight:600, color:q.failRate > 20 ? RED : q.failRate > 10 ? ORANGE : TEXT }}>{q.failRate}%</td>
                        <td style={{ padding:"8px 10px", color:TEXT_SUB }}>{q.evalCount}</td>
                        <td style={{ padding:"8px 10px", color:q.trend.startsWith("+") ? GREEN : RED, fontWeight:500 }}>{q.trend}</td>
                        <td style={{ padding:"8px 10px", fontSize:12, color:TEXT_SUB, fontStyle:"italic" }}>{q.topMiss}</td>
                      </tr>
                      {expandedQ === q.question && (
                        <tr><td colSpan={7} style={{ padding:0 }}>
                          <div style={{ background:"#f8fafc", border:`1px solid ${BORDER}`, borderTop:"none", padding:"12px 16px", margin:"0 10px 8px 30px", borderRadius:"0 0 8px 8px" }}>
                            <div style={{ fontSize:12, fontWeight:600, color:TEXT, marginBottom:8 }}>Agents who missed "{q.question}" ({(agentsMissedQuestion[q.question] || []).length} agents)</div>
                            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                              <thead><tr style={{ borderBottom:`1px solid ${BORDER}` }}>
                                {["Agent","Department","Question Score","Overall QA","Status"].map(h => <th key={h} style={{ padding:"4px 8px", textAlign:"left", fontSize:10, fontWeight:600, color:TEXT_SUB }}>{h}</th>)}
                              </tr></thead>
                              <tbody>
                                {(agentsMissedQuestion[q.question] || [{ name:"No drill-down data", dept:"-", score:"-", qa:"-" }]).map((a, ai) => (
                                  <tr key={ai} style={{ borderBottom:`1px solid ${BORDER}`, cursor:"pointer" }}
                                    onClick={(e) => { e.stopPropagation(); const found = mockAgents.find(ma => ma.name === a.name); if(found) { setAgent(found); setView(V.AGENT); } }}
                                    onMouseOver={e => e.currentTarget.style.background=CARD}
                                    onMouseOut={e => e.currentTarget.style.background="transparent"}>
                                    <td style={{ padding:"6px 8px", fontWeight:500, color:BRAND_DARK }}>{a.name}</td>
                                    <td style={{ padding:"6px 8px", color:TEXT_SUB }}>{a.dept}</td>
                                    <td style={{ padding:"6px 8px", fontWeight:600, color: a.score === 0 ? RED : ORANGE }}>{a.score}%</td>
                                    <td style={{ padding:"6px 8px", color: getColor("avg_qa_score", a.qa) }}>{a.qa}%</td>
                                    <td style={{ padding:"6px 8px" }}>{a.qa < 80 ? <Badge val="At Risk" /> : <Badge val="OK" good />}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            <div style={{ marginTop:6, fontSize:11, color:TEXT_SUB }}>Click an agent name to view their full profile.</div>
                          </div>
                        </td></tr>
                      )}
                    </React.Fragment>
                  ));
                })()}</tbody>
              </table>
            </Section>

            {/* ── ROW 7: Department Comparison ── */}
            <Section title="Department Comparison">
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                <thead><tr style={{ borderBottom:`2px solid ${BORDER}` }}>
                  {["Department","QA Score","Audit Rate","Dispute Rate","Adjusted Rate","Critical Fails","Time to Audit"].map(h => <th key={h} style={{ padding:"8px 12px", textAlign:"left", fontSize:11, fontWeight:600, color:TEXT_SUB }}>{h}</th>)}
                </tr></thead>
                <tbody>{DEPTS.filter(x => x !== "All Departments").map(x => { const dd = D[x]; return (
                  <tr key={x} style={{ borderBottom:`1px solid ${BORDER}`, cursor:"pointer" }} onClick={() => setSelectedDepts([x])}
                    onMouseOver={e => e.currentTarget.style.background=BLUE_LIGHT} onMouseOut={e => e.currentTarget.style.background="transparent"}>
                    <td style={{ padding:"10px 12px", fontWeight:500 }}>{x}</td>
                    <td style={{ padding:"10px 12px" }}><Dot k="avg_qa_score" v={dd.avg_qa_score} />{dd.avg_qa_score}%</td>
                    <td style={{ padding:"10px 12px" }}><Dot k="audit_completion_rate" v={dd.audit_completion_rate} />{dd.audit_completion_rate}%</td>
                    <td style={{ padding:"10px 12px" }}><Dot k="dispute_rate" v={dd.dispute_rate} />{dd.dispute_rate}%</td>
                    <td style={{ padding:"10px 12px" }}><Dot k="dispute_adjusted_rate" v={dd.dispute_adjusted_rate} />{dd.dispute_adjusted_rate}%</td>
                    <td style={{ padding:"10px 12px" }}><Dot k="critical_fail_rate" v={dd.critical_fail_rate} />{dd.critical_fail_rate}%</td>
                    <td style={{ padding:"10px 12px" }}><Dot k="time_to_audit" v={dd.time_to_audit} />{dd.time_to_audit} days</td>
                  </tr>
                );})}</tbody>
              </table>
            </Section>
          </>}

          {/* ═══ COACHING ═══ */}
          {view === V.TRAINING && <>
            <h2 style={{ fontSize:20, fontWeight:700, marginBottom:4 }}>Coaching</h2>
            <p style={{ fontSize:13, color:TEXT_SUB, marginBottom:20 }}>{dept} · {timeDisplay} · Assessing coaching team execution and effectiveness</p>

            {/* ── ROW 1: Coaching Pace & Delivery KPIs ── */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:16, marginBottom:20 }}>
              <Tile k="coaching_sessions_assigned" v={d.coaching_sessions_assigned} pv={p.coaching_sessions_assigned} />
              <Tile k="coaching_sessions_completed" v={d.coaching_sessions_completed} pv={p.coaching_sessions_completed} />
              <Tile k="coaching_completion_rate" v={d.coaching_completion_rate} pv={p.coaching_completion_rate} />
              <Tile k="coaching_cadence" v={d.coaching_cadence} pv={p.coaching_cadence} />
              <Tile k="coaching_delivery_rate" v={d.coaching_delivery_rate} pv={p.coaching_delivery_rate} />
            </div>

            {/* ── ROW 2: Topics Covered (expandable rows) ── */}
            <Section title="Most Coached Topics">
              <p style={{ fontSize:12, color:TEXT_SUB, marginBottom:12 }}>Topics with the most coaching sessions this period. Click a topic to see which agents were coached and their linked accounts.</p>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                <thead><tr style={{ borderBottom:`2px solid ${BORDER}` }}>
                  {["","Topic","Sessions","Agents","Repeat Rate","Bar"].map(h => <th key={h} style={{ padding:"8px 10px", textAlign:"left", fontSize:11, fontWeight:600, color:TEXT_SUB }}>{h}</th>)}
                </tr></thead>
                <tbody>{(() => {
                  const maxCount = Math.max(...coachingTopics.map(t => t.count));
                  return coachingTopics.map((t, i) => (
                    <React.Fragment key={i}>
                      <tr style={{ borderBottom: expandedTopic === t.topic ? "none" : `1px solid ${BORDER}`, cursor:"pointer", background: expandedTopic === t.topic ? BLUE_LIGHT : "transparent" }}
                        onClick={() => setExpandedTopic(expandedTopic === t.topic ? null : t.topic)}
                        onMouseOver={e => { if(expandedTopic !== t.topic) e.currentTarget.style.background=BLUE_LIGHT; }}
                        onMouseOut={e => { if(expandedTopic !== t.topic) e.currentTarget.style.background="transparent"; }}>
                        <td style={{ padding:"8px 10px", fontWeight:600, color:TEXT_SUB, width:30 }}>{expandedTopic === t.topic ? "▼" : "▶"}</td>
                        <td style={{ padding:"8px 10px", fontWeight:500 }}>{t.topic}</td>
                        <td style={{ padding:"8px 10px", fontWeight:600 }}>{t.count}</td>
                        <td style={{ padding:"8px 10px", color:TEXT_SUB }}>{t.agents}</td>
                        <td style={{ padding:"8px 10px", fontWeight:600, color: t.repeatRate > 30 ? RED : t.repeatRate > 15 ? ORANGE : t.repeatRate > 0 ? TEXT : GREEN }}>{t.repeatRate > 0 ? `${t.repeatRate}%` : "—"}</td>
                        <td style={{ padding:"8px 10px", width:160 }}>
                          <div style={{ height:14, background:BORDER, borderRadius:3, overflow:"hidden" }}>
                            <div style={{ height:"100%", width:`${(t.count/maxCount)*100}%`, background: t.repeatRate > 30 ? RED : t.repeatRate > 15 ? ORANGE : BRAND, borderRadius:3 }} />
                          </div>
                        </td>
                      </tr>
                      {expandedTopic === t.topic && coachingTopicAgents[t.topic] && (
                        <tr><td colSpan={6} style={{ padding:0 }}>
                          <div style={{ background:"#f8fafc", border:`1px solid ${BORDER}`, borderTop:"none", padding:"12px 16px", margin:"0 10px 8px 30px", borderRadius:"0 0 8px 8px" }}>
                            <div style={{ fontSize:12, fontWeight:600, color:TEXT, marginBottom:8 }}>Agents coached on "{t.topic}" ({coachingTopicAgents[t.topic].length} agents)</div>
                            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                              <thead><tr style={{ borderBottom:`1px solid ${BORDER}` }}>
                                {["Agent","Dept","Sessions","Last Coached","Accounts","Repeat?"].map(h => <th key={h} style={{ padding:"4px 6px", textAlign:"left", fontSize:10, fontWeight:600, color:TEXT_SUB }}>{h}</th>)}
                              </tr></thead>
                              <tbody>
                                {coachingTopicAgents[t.topic].map((a, ai) => (
                                  <tr key={ai} style={{ borderBottom:`1px solid ${BORDER}`, cursor:"pointer" }}
                                    onClick={(e) => { e.stopPropagation(); const found = mockAgents.find(ma => ma.name === a.name); if(found) { setAgent(found); setView(V.AGENT); } }}
                                    onMouseOver={e => e.currentTarget.style.background=CARD}
                                    onMouseOut={e => e.currentTarget.style.background="transparent"}>
                                    <td style={{ padding:"6px 6px", fontWeight:500, color:BRAND_DARK }}>{a.name}</td>
                                    <td style={{ padding:"6px 6px", color:TEXT_SUB, fontSize:11 }}>{a.dept}</td>
                                    <td style={{ padding:"6px 6px", fontWeight:600, color: a.sessions >= 3 ? RED : a.sessions >= 2 ? ORANGE : TEXT }}>{a.sessions}</td>
                                    <td style={{ padding:"6px 6px", color:TEXT_SUB, fontSize:11 }}>{a.lastCoached}</td>
                                    <td style={{ padding:"6px 6px", color:TEXT_SUB, fontSize:11 }}>{a.accounts}</td>
                                    <td style={{ padding:"6px 6px" }}>{a.repeat ? <Badge val="Repeat" /> : <Badge val="First" good />}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            <div style={{ marginTop:6, fontSize:11, color:TEXT_SUB }}>Click an agent name to view their full profile.</div>
                          </div>
                        </td></tr>
                      )}
                    </React.Fragment>
                  ));
                })()}</tbody>
              </table>
            </Section>

            {/* ── ROW 3: Repeat Offenders (agents) with expandable topic list ── */}
            <Section title="Repeat Coaching — Agents Needing Escalation">
              <p style={{ fontSize:12, color:TEXT_SUB, marginBottom:12 }}>Agents coached on the same topic multiple times. Click a row to see their repeat topics breakdown.</p>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                <thead><tr style={{ borderBottom:`2px solid ${BORDER}` }}>
                  {["","Agent","Department","Total Sessions","Unique Topics","Repeat Topics","QA Score","Status"].map(h => <th key={h} style={{ padding:"8px 10px", textAlign:"left", fontSize:11, fontWeight:600, color:TEXT_SUB }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {repeatOffenders.map((a, i) => (
                    <React.Fragment key={i}>
                      <tr style={{ borderBottom: expandedRepeat === a.name ? "none" : `1px solid ${BORDER}`, cursor:"pointer", background: expandedRepeat === a.name ? RED_LIGHT : "transparent" }}
                        onClick={() => setExpandedRepeat(expandedRepeat === a.name ? null : a.name)}
                        onMouseOver={e => { if(expandedRepeat !== a.name) e.currentTarget.style.background=RED_LIGHT; }}
                        onMouseOut={e => { if(expandedRepeat !== a.name) e.currentTarget.style.background="transparent"; }}>
                        <td style={{ padding:"8px 10px", fontWeight:600, color:TEXT_SUB, width:30 }}>{expandedRepeat === a.name ? "▼" : "▶"}</td>
                        <td style={{ padding:"10px 10px", fontWeight:500, color:BRAND_DARK }}>{a.name}</td>
                        <td style={{ padding:"10px 10px", color:TEXT_SUB }}>{a.dept}</td>
                        <td style={{ padding:"10px 10px", fontWeight:600 }}>{a.totalSessions}</td>
                        <td style={{ padding:"10px 10px" }}>{a.uniqueTopics}</td>
                        <td style={{ padding:"10px 10px", fontWeight:600, color: a.repeatTopics >= 2 ? RED : ORANGE }}>{a.repeatTopics}</td>
                        <td style={{ padding:"10px 10px", color: getColor("avg_qa_score", a.qa) }}>{a.qa}%</td>
                        <td style={{ padding:"10px 10px" }}>{a.qa < 80 ? <Badge val="At Risk" /> : a.repeatTopics >= 2 ? <Badge val="Watch" /> : <Badge val="OK" good />}</td>
                      </tr>
                      {expandedRepeat === a.name && (
                        <tr><td colSpan={8} style={{ padding:0 }}>
                          <div style={{ background:"#f8fafc", border:`1px solid ${BORDER}`, borderTop:"none", padding:"12px 16px", margin:"0 10px 8px 30px", borderRadius:"0 0 8px 8px" }}>
                            <div style={{ fontSize:12, fontWeight:600, color:TEXT, marginBottom:8 }}>Coaching Topics for {a.name} ({a.topics.length} topics)</div>
                            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                              <thead><tr style={{ borderBottom:`1px solid ${BORDER}` }}>
                                {["Topic","Sessions","Status"].map(h => <th key={h} style={{ padding:"4px 8px", textAlign:"left", fontSize:10, fontWeight:600, color:TEXT_SUB }}>{h}</th>)}
                              </tr></thead>
                              <tbody>
                                {a.topics.map((t, ti) => (
                                  <tr key={ti} style={{ borderBottom:`1px solid ${BORDER}` }}>
                                    <td style={{ padding:"6px 8px", fontWeight:500 }}>{t.topic}</td>
                                    <td style={{ padding:"6px 8px", fontWeight:600, color: t.count >= 3 ? RED : t.count >= 2 ? ORANGE : TEXT }}>{t.count}×</td>
                                    <td style={{ padding:"6px 8px" }}>{t.count >= 2 ? <Badge val="Repeat" /> : <Badge val="First" good />}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            <div style={{ marginTop:6, fontSize:11, color:BRAND, cursor:"pointer" }}
                              onClick={(e) => { e.stopPropagation(); const found = mockAgents.find(ma => ma.name === a.name); if(found) { setAgent(found); setView(V.AGENT); } }}>
                              View full agent profile →
                            </div>
                          </div>
                        </td></tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </Section>

            {/* ── ROW 4: Quiz Performance (full-width stacked) ── */}
            <Section title="Quiz Performance">
              <p style={{ fontSize:12, color:TEXT_SUB, marginBottom:12 }}>Quizzes assigned during coaching sessions to verify knowledge retention.</p>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:14, marginBottom:20 }}>
                <Tile k="quiz_pass_rate" v={d.quiz_pass_rate} pv={p.quiz_pass_rate} sm />
                <Tile k="avg_quiz_score" v={d.avg_quiz_score} pv={p.avg_quiz_score} sm />
                <Tile k="avg_attempts_to_pass" v={d.avg_attempts_to_pass} pv={p.avg_attempts_to_pass} sm />
              </div>

              <div style={{ fontSize:13, fontWeight:600, marginBottom:8 }}>Quiz Breakdown</div>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13, marginBottom:20 }}>
                <thead><tr style={{ borderBottom:`2px solid ${BORDER}` }}>
                  {["Quiz","Attempts","Pass Rate","Avg Score","Avg Tries","Fails"].map(h => <th key={h} style={{ padding:"8px 10px", textAlign:"left", fontSize:11, fontWeight:600, color:TEXT_SUB }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {quizList.map((q, i) => (
                    <tr key={i} style={{ borderBottom:`1px solid ${BORDER}` }}
                      onMouseOver={e => e.currentTarget.style.background=BLUE_LIGHT}
                      onMouseOut={e => e.currentTarget.style.background="transparent"}>
                      <td style={{ padding:"10px 10px", fontWeight:500 }}>{q.name}</td>
                      <td style={{ padding:"10px 10px", color:TEXT_SUB }}>{q.attempts}</td>
                      <td style={{ padding:"10px 10px", fontWeight:600, color: q.passRate >= 80 ? GREEN : q.passRate >= 65 ? ORANGE : RED }}>{q.passRate}%</td>
                      <td style={{ padding:"10px 10px", color: q.avgScore >= 80 ? GREEN : q.avgScore >= 65 ? ORANGE : RED }}>{q.avgScore}%</td>
                      <td style={{ padding:"10px 10px", color: q.avgAttempts <= 1.3 ? GREEN : q.avgAttempts <= 1.8 ? ORANGE : RED }}>{q.avgAttempts}</td>
                      <td style={{ padding:"10px 10px", fontWeight:600, color: q.fails > 10 ? RED : q.fails > 5 ? ORANGE : TEXT }}>{q.fails}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ fontSize:13, fontWeight:600, marginBottom:8 }}>Agents with Most Failed Quizzes</div>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                <thead><tr style={{ borderBottom:`2px solid ${BORDER}` }}>
                  {["Agent","Department","Failed Quizzes","Fails","Avg Score","QA Score"].map(h => <th key={h} style={{ padding:"8px 10px", textAlign:"left", fontSize:11, fontWeight:600, color:TEXT_SUB }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {agentsFailedQuizzes.map((a, i) => (
                    <tr key={i} style={{ borderBottom:`1px solid ${BORDER}`, cursor:"pointer" }}
                      onClick={() => { const found = mockAgents.find(ma => ma.name === a.name); if(found) { setAgent(found); setView(V.AGENT); } }}
                      onMouseOver={e => e.currentTarget.style.background=RED_LIGHT}
                      onMouseOut={e => e.currentTarget.style.background="transparent"}>
                      <td style={{ padding:"10px 10px", fontWeight:500, color:BRAND_DARK }}>{a.name}</td>
                      <td style={{ padding:"10px 10px", color:TEXT_SUB }}>{a.dept}</td>
                      <td style={{ padding:"10px 10px", fontSize:12, color:TEXT_SUB }}>{a.quizzes.join(", ")}</td>
                      <td style={{ padding:"10px 10px", fontWeight:700, color:RED }}>{a.failed}</td>
                      <td style={{ padding:"10px 10px", color: a.avgScore >= 70 ? ORANGE : RED }}>{a.avgScore}%</td>
                      <td style={{ padding:"10px 10px", color: getColor("avg_qa_score", a.qa) }}>{a.qa}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>

            {/* ── ROW 5: Department Comparison ── */}
            <Section title="Department Coaching Comparison">
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                <thead><tr style={{ borderBottom:`2px solid ${BORDER}` }}>
                  {["Department","Assigned","Completed","Completion %","Cadence","Delivery","Quiz Pass","Avg Quiz","Attempts"].map(h => <th key={h} style={{ padding:"8px 12px", textAlign:"left", fontSize:11, fontWeight:600, color:TEXT_SUB }}>{h}</th>)}
                </tr></thead>
                <tbody>{DEPTS.filter(x => x!=="All Departments").map(x => { const dd=D[x]; return (
                  <tr key={x} style={{ borderBottom:`1px solid ${BORDER}`, cursor:"pointer" }} onClick={() => setSelectedDepts([x])}
                    onMouseOver={e => e.currentTarget.style.background=BLUE_LIGHT} onMouseOut={e => e.currentTarget.style.background="transparent"}>
                    <td style={{ padding:"10px 12px", fontWeight:500 }}>{x}</td>
                    <td style={{ padding:"10px 12px" }}>{dd.coaching_sessions_assigned}</td>
                    <td style={{ padding:"10px 12px" }}>{dd.coaching_sessions_completed}</td>
                    <td style={{ padding:"10px 12px" }}><Dot k="coaching_completion_rate" v={dd.coaching_completion_rate} />{dd.coaching_completion_rate}%</td>
                    <td style={{ padding:"10px 12px" }}><Dot k="coaching_cadence" v={dd.coaching_cadence} />{dd.coaching_cadence}%</td>
                    <td style={{ padding:"10px 12px" }}><Dot k="coaching_delivery_rate" v={dd.coaching_delivery_rate} />{dd.coaching_delivery_rate}%</td>
                    <td style={{ padding:"10px 12px" }}><Dot k="quiz_pass_rate" v={dd.quiz_pass_rate} />{dd.quiz_pass_rate}%</td>
                    <td style={{ padding:"10px 12px" }}>{dd.avg_quiz_score}%</td>
                    <td style={{ padding:"10px 12px" }}><Dot k="avg_attempts_to_pass" v={dd.avg_attempts_to_pass} />{dd.avg_attempts_to_pass}</td>
                  </tr>
                );})}</tbody>
              </table>
            </Section>
          </>}

          {/* ═══ PERFORMANCE WARNINGS ═══ */}
          {view === V.COACHING && <>
            <h2 style={{ fontSize:20, fontWeight:700, marginBottom:4 }}>Performance Warnings</h2>
            <p style={{ fontSize:13, color:TEXT_SUB, marginBottom:20 }}>{dept} · {timeDisplay} · Tracking write-ups, escalations, and resolution across the organization</p>

            {/* ── ROW 1: Headline KPIs ── */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:16, marginBottom:20 }}>
              <Tile k="total_writeups_issued" v={d.total_writeups_issued} pv={p.total_writeups_issued} />
              <Tile k="escalation_rate" v={d.escalation_rate} pv={p.escalation_rate} />
              <Tile k="repeat_offender_rate" v={d.repeat_offender_rate} pv={p.repeat_offender_rate} />
            </div>

            {/* ── ROW 2: Status Pipeline + Type Breakdown ── */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:20 }}>
              <Section title="Write-Up Status Pipeline">
                <p style={{ fontSize:12, color:TEXT_SUB, marginBottom:12 }}>Current state of all write-ups in the selected period.</p>
                {[
                  { status: "Draft", count: 1, color: TEXT_SUB },
                  { status: "Scheduled", count: 0, color: PURPLE },
                  { status: "Delivered", count: 1, color: BRAND },
                  { status: "Awaiting Signature", count: 1, color: ORANGE },
                  { status: "Signed", count: 1, color: YELLOW },
                  { status: "Follow-Up Pending", count: 2, color: RED },
                  { status: "Closed", count: 4, color: GREEN },
                ].map((s, i) => (
                  <div key={i} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"6px 0", borderBottom: i < 6 ? `1px solid ${BORDER}` : "none" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <div style={{ width:10, height:10, borderRadius:"50%", background:s.color }} />
                      <span style={{ fontSize:13, fontWeight:500 }}>{s.status}</span>
                    </div>
                    <span style={{ fontSize:14, fontWeight:700, color: s.count > 0 ? s.color : TEXT_SUB }}>{s.count}</span>
                  </div>
                ))}
                <div style={{ display:"flex", justifyContent:"space-between", padding:"8px 0", borderTop:`2px solid ${BORDER}`, marginTop:4 }}>
                  <span style={{ fontSize:13, fontWeight:700 }}>Total Active</span>
                  <span style={{ fontSize:14, fontWeight:700 }}>10</span>
                </div>
              </Section>

              <Section title="Write-Up Type Distribution">
                <p style={{ fontSize:12, color:TEXT_SUB, marginBottom:12 }}>Severity breakdown: Verbal → Written → Final escalation path.</p>
                {[
                  { type: "Verbal Warning", count: 3, pct: 30, color: YELLOW },
                  { type: "Written Warning", count: 5, pct: 50, color: ORANGE },
                  { type: "Final Warning", count: 2, pct: 20, color: RED },
                ].map((t, i) => (
                  <div key={i} style={{ marginBottom:14 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, marginBottom:4 }}>
                      <span style={{ fontWeight:500 }}>{t.type}</span>
                      <span style={{ color:TEXT_SUB }}>{t.count} ({t.pct}%)</span>
                    </div>
                    <div style={{ height:22, background:BORDER, borderRadius:4, overflow:"hidden" }}>
                      <div style={{ height:"100%", width:`${t.pct}%`, background:t.color, borderRadius:4, transition:"width .3s" }} />
                    </div>
                  </div>
                ))}
                <div style={{ marginTop:8 }}>
                  <Stat label="Avg Days to Closure" value="18.5 days" />
                  <Stat label="Pending Follow-Ups" value="4" color={ORANGE} />
                  <Stat label="Overdue Follow-Ups" value="1" color={RED} />
                </div>
              </Section>
            </div>

            {/* ── ROW 3: Active Write-Ups Table ── */}
            <Section title="Active Write-Ups">
              <p style={{ fontSize:12, color:TEXT_SUB, marginBottom:12 }}>All write-ups in the selected period. Click a row to view agent profile.</p>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                <thead><tr style={{ borderBottom:`2px solid ${BORDER}` }}>
                  {["Agent","Dept","Type","Status","Created","Meeting","Follow-Up","Prior","Policies"].map(h => <th key={h} style={{ padding:"8px 8px", textAlign:"left", fontSize:10, fontWeight:600, color:TEXT_SUB }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {writeUpMockData.map((w, i) => {
                    const typeColors = { VERBAL_WARNING: YELLOW, WRITTEN_WARNING: ORANGE, FINAL_WARNING: RED };
                    const typeLabels = { VERBAL_WARNING: "Verbal", WRITTEN_WARNING: "Written", FINAL_WARNING: "Final" };
                    const statusLabels = { DRAFT: "Draft", SCHEDULED: "Scheduled", DELIVERED: "Delivered", AWAITING_SIGNATURE: "Awaiting Sig.", SIGNED: "Signed", FOLLOW_UP_PENDING: "Follow-Up", CLOSED: "Closed" };
                    const statusColors = { DRAFT: TEXT_SUB, SCHEDULED: PURPLE, DELIVERED: BRAND, AWAITING_SIGNATURE: ORANGE, SIGNED: YELLOW, FOLLOW_UP_PENDING: RED, CLOSED: GREEN };
                    return (
                      <tr key={i} style={{ borderBottom:`1px solid ${BORDER}`, cursor:"pointer" }}
                        onClick={() => { const found = mockAgents.find(ma => ma.name === w.name); if(found) { setAgent(found); setView(V.AGENT); } }}
                        onMouseOver={e => e.currentTarget.style.background=RED_LIGHT}
                        onMouseOut={e => e.currentTarget.style.background="transparent"}>
                        <td style={{ padding:"8px 8px", fontWeight:500, color:BRAND_DARK }}>{w.name}</td>
                        <td style={{ padding:"8px 8px", color:TEXT_SUB, fontSize:11 }}>{w.dept}</td>
                        <td style={{ padding:"8px 8px" }}>
                          <span style={{ display:"inline-block", padding:"2px 8px", borderRadius:4, fontSize:11, fontWeight:600, background:typeColors[w.type]+"22", color:typeColors[w.type] }}>{typeLabels[w.type]}</span>
                        </td>
                        <td style={{ padding:"8px 8px" }}>
                          <span style={{ display:"inline-block", padding:"2px 8px", borderRadius:4, fontSize:11, fontWeight:600, background:statusColors[w.status]+"22", color:statusColors[w.status] }}>{statusLabels[w.status]}</span>
                        </td>
                        <td style={{ padding:"8px 8px", fontSize:11, color:TEXT_SUB }}>{w.created}</td>
                        <td style={{ padding:"8px 8px", fontSize:11, color:TEXT_SUB }}>{w.meetingDate || "—"}</td>
                        <td style={{ padding:"8px 8px", fontSize:11, color: w.followUpDate ? ORANGE : TEXT_SUB }}>{w.followUpDate || "—"}</td>
                        <td style={{ padding:"8px 8px", fontWeight:600, color: w.priorCount > 0 ? RED : GREEN }}>{w.priorCount}</td>
                        <td style={{ padding:"8px 8px", fontSize:11, color:TEXT_SUB }}>{w.policies.join(", ")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Section>

            {/* ── ROW 4: Escalation Path + Repeat Offenders ── */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:20 }}>
              <Section title="Escalation Path">
                <p style={{ fontSize:12, color:TEXT_SUB, marginBottom:12 }}>Agents who have progressed through the escalation pipeline.</p>
                <div style={{ display:"flex", alignItems:"center", gap:8, fontSize:13, flexWrap:"wrap", padding:"8px 0", marginBottom:12 }}>
                  <div style={{ background:YELLOW+"22", padding:"10px 20px", borderRadius:8, textAlign:"center", border:`1px solid ${YELLOW}` }}>
                    <div style={{ fontSize:11, color:TEXT_SUB }}>Verbal</div>
                    <div style={{ fontSize:22, fontWeight:700, color:YELLOW }}>3</div>
                  </div>
                  <span style={{ fontSize:18, color:TEXT_SUB }}>→</span>
                  <div style={{ background:ORANGE+"22", padding:"10px 20px", borderRadius:8, textAlign:"center", border:`1px solid ${ORANGE}` }}>
                    <div style={{ fontSize:11, color:TEXT_SUB }}>Written</div>
                    <div style={{ fontSize:22, fontWeight:700, color:ORANGE }}>5</div>
                  </div>
                  <span style={{ fontSize:18, color:TEXT_SUB }}>→</span>
                  <div style={{ background:RED+"22", padding:"10px 20px", borderRadius:8, textAlign:"center", border:`1px solid ${RED}` }}>
                    <div style={{ fontSize:11, color:TEXT_SUB }}>Final</div>
                    <div style={{ fontSize:22, fontWeight:700, color:RED }}>2</div>
                  </div>
                </div>
                <Stat label="Escalation Rate (Verbal → Written)" value="3 of 8 (18.1%)" color={d.escalation_rate > 20 ? RED : ORANGE} />
                <Stat label="Escalation Rate (Written → Final)" value="2 of 5 (40.0%)" color={RED} />
                <Stat label="Agents currently on Final Warning" value="2" color={RED} />
              </Section>

              <Section title="Repeat Write-Up Agents">
                <p style={{ fontSize:12, color:TEXT_SUB, marginBottom:12 }}>Agents with multiple write-ups within 90 days.</p>
                {writeUpMockData.filter(w => w.priorCount > 0).map((w, i) => {
                  const typeLabels = { VERBAL_WARNING: "Verbal", WRITTEN_WARNING: "Written", FINAL_WARNING: "Final" };
                  const typeColors = { VERBAL_WARNING: YELLOW, WRITTEN_WARNING: ORANGE, FINAL_WARNING: RED };
                  const statusLabels = { DRAFT: "Draft", SCHEDULED: "Scheduled", DELIVERED: "Delivered", AWAITING_SIGNATURE: "Awaiting Sig.", SIGNED: "Signed", FOLLOW_UP_PENDING: "Follow-Up", CLOSED: "Closed" };
                  return (
                    <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 4px", borderBottom:`1px solid ${BORDER}`, cursor:"pointer" }}
                      onClick={() => { const found = mockAgents.find(ma => ma.name === w.name); if(found) { setAgent(found); setView(V.AGENT); } }}
                      onMouseOver={e => e.currentTarget.style.background=RED_LIGHT}
                      onMouseOut={e => e.currentTarget.style.background="transparent"}>
                      <span style={{ fontWeight:500, color:BRAND_DARK, fontSize:13 }}>{w.name}</span>
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <span style={{ fontSize:11, color:TEXT_SUB }}>Prior: {w.priorCount}</span>
                        <span style={{ fontSize:11, color:TEXT_SUB }}>·</span>
                        <span style={{ display:"inline-block", padding:"2px 8px", borderRadius:4, fontSize:11, fontWeight:600, background:typeColors[w.type]+"22", color:typeColors[w.type] }}>
                          {typeLabels[w.type]}
                        </span>
                        <span style={{ fontSize:11, color:TEXT_SUB }}>{statusLabels[w.status]}</span>
                      </div>
                    </div>
                  );
                })}
              </Section>
            </div>

            {/* ── ROW 5: Top Policies Violated with agent drill-down ── */}
            <Section title="Most Violated Policies">
              <p style={{ fontSize:12, color:TEXT_SUB, marginBottom:12 }}>Policies cited most frequently across all write-ups this period. Click to see agents.</p>
              {[
                { policy: "Attendance Policy", count: 4, agents: 3 },
                { policy: "Customer Communication Standards", count: 3, agents: 2 },
                { policy: "Troubleshooting SOP", count: 2, agents: 2 },
                { policy: "Quality Standards", count: 2, agents: 1 },
                { policy: "Documentation Requirements", count: 1, agents: 1 },
                { policy: "Code of Conduct", count: 1, agents: 1 },
                { policy: "Billing Accuracy Policy", count: 1, agents: 1 },
              ].map((pol, i) => {
                const maxCount = 4;
                const isExpanded = expandedPolicy === pol.policy;
                const polAgents = policyAgents[pol.policy] || [];
                const typeLabels = { VERBAL_WARNING: "Verbal", WRITTEN_WARNING: "Written", FINAL_WARNING: "Final" };
                const typeColors = { VERBAL_WARNING: YELLOW, WRITTEN_WARNING: ORANGE, FINAL_WARNING: RED };
                const statusLabels = { DRAFT: "Draft", SCHEDULED: "Scheduled", DELIVERED: "Delivered", AWAITING_SIGNATURE: "Awaiting Sig.", SIGNED: "Signed", FOLLOW_UP_PENDING: "Follow-Up", CLOSED: "Closed" };
                return (
                  <div key={i} style={{ marginBottom:isExpanded ? 14 : 10 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, marginBottom:3, cursor:"pointer", padding:"4px 0" }}
                      onClick={() => setExpandedPolicy(isExpanded ? null : pol.policy)}
                      onMouseOver={e => e.currentTarget.style.background=BLUE_LIGHT}
                      onMouseOut={e => e.currentTarget.style.background="transparent"}>
                      <span style={{ fontWeight:500, display:"flex", alignItems:"center", gap:6 }}>
                        <span style={{ color:TEXT_SUB, fontSize:10 }}>{isExpanded ? "▼" : "▶"}</span>
                        {pol.policy}
                      </span>
                      <span style={{ color:TEXT_SUB }}>{pol.count} violations · {pol.agents} agents</span>
                    </div>
                    <div style={{ height:16, background:BORDER, borderRadius:3, overflow:"hidden" }}>
                      <div style={{ height:"100%", width:`${(pol.count/maxCount)*100}%`, background: pol.count >= 3 ? RED : pol.count >= 2 ? ORANGE : BRAND, borderRadius:3, transition:"width .3s" }} />
                    </div>
                    {isExpanded && polAgents.length > 0 && (
                      <div style={{ background:"#f8fafc", border:`1px solid ${BORDER}`, padding:"10px 14px", marginTop:6, borderRadius:8 }}>
                        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                          <thead><tr style={{ borderBottom:`1px solid ${BORDER}` }}>
                            {["Agent","Dept","Type","Status"].map(h => <th key={h} style={{ padding:"4px 8px", textAlign:"left", fontSize:10, fontWeight:600, color:TEXT_SUB }}>{h}</th>)}
                          </tr></thead>
                          <tbody>
                            {polAgents.map((a, ai) => (
                              <tr key={ai} style={{ borderBottom:`1px solid ${BORDER}`, cursor:"pointer" }}
                                onClick={() => { const found = mockAgents.find(ma => ma.name === a.name); if(found) { setAgent(found); setView(V.AGENT); } }}
                                onMouseOver={e => e.currentTarget.style.background=CARD}
                                onMouseOut={e => e.currentTarget.style.background="transparent"}>
                                <td style={{ padding:"6px 8px", fontWeight:500, color:BRAND_DARK }}>{a.name}</td>
                                <td style={{ padding:"6px 8px", color:TEXT_SUB }}>{a.dept}</td>
                                <td style={{ padding:"6px 8px" }}>
                                  <span style={{ display:"inline-block", padding:"2px 6px", borderRadius:4, fontSize:10, fontWeight:600, background:typeColors[a.type]+"22", color:typeColors[a.type] }}>{typeLabels[a.type]}</span>
                                </td>
                                <td style={{ padding:"6px 8px", fontSize:11, color:TEXT_SUB }}>{statusLabels[a.status]}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </Section>

            {/* ── ROW 6: Department Comparison ── */}
            <Section title="Department Write-Up Comparison">
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                <thead><tr style={{ borderBottom:`2px solid ${BORDER}` }}>
                  {["Department","Write-Up Rate","Escalation","Repeat Offender","Resolution","Active","Closed"].map(h => <th key={h} style={{ padding:"8px 12px", textAlign:"left", fontSize:11, fontWeight:600, color:TEXT_SUB }}>{h}</th>)}
                </tr></thead>
                <tbody>{DEPTS.filter(x => x!=="All Departments").map(x => { const dd=D[x]; return (
                  <tr key={x} style={{ borderBottom:`1px solid ${BORDER}`, cursor:"pointer" }} onClick={() => setSelectedDepts([x])}
                    onMouseOver={e => e.currentTarget.style.background=BLUE_LIGHT} onMouseOut={e => e.currentTarget.style.background="transparent"}>
                    <td style={{ padding:"10px 12px", fontWeight:500 }}>{x}</td>
                    <td style={{ padding:"10px 12px" }}>{dd.writeup_rate}</td>
                    <td style={{ padding:"10px 12px" }}><Dot k="escalation_rate" v={dd.escalation_rate} />{dd.escalation_rate}%</td>
                    <td style={{ padding:"10px 12px" }}><Dot k="repeat_offender_rate" v={dd.repeat_offender_rate} />{dd.repeat_offender_rate}%</td>
                    <td style={{ padding:"10px 12px" }}><Dot k="writeup_resolution_rate" v={dd.writeup_resolution_rate} />{dd.writeup_resolution_rate}%</td>
                    <td style={{ padding:"10px 12px", fontWeight:600, color:ORANGE }}>{Math.round(dd.writeup_rate * 0.4)}</td>
                    <td style={{ padding:"10px 12px", color:GREEN }}>{Math.round(dd.writeup_rate * 0.6)}</td>
                  </tr>
                );})}</tbody>
              </table>
            </Section>
          </>}



          {/* ═══ AGENT LIST ═══ */}
          {view === V.AGENTS && <>
            <h2 style={{ fontSize:20, fontWeight:700, marginBottom:4 }}>Agent Performance</h2>
            <p style={{ fontSize:13, color:TEXT_SUB, marginBottom:20 }}>{dept} · {timeDisplay} · Click any agent to view their full profile</p>
            <Section title="">
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                <thead><tr style={{ borderBottom:`2px solid ${BORDER}` }}>
                  {["Agent","Department","QA Score","Trend","Cadence","Quiz","Sessions","Disputes","Write-Ups","Status"].map(h => <th key={h} style={{ padding:"8px 12px", textAlign:"left", fontSize:11, fontWeight:600, color:TEXT_SUB }}>{h}</th>)}
                </tr></thead>
                <tbody>{agents.map((a, i) => (
                  <tr key={i} style={{ borderBottom:`1px solid ${BORDER}`, cursor:"pointer" }}
                    onClick={() => { setAgent(a); setView(V.AGENT); }}
                    onMouseOver={e => e.currentTarget.style.background=BLUE_LIGHT} onMouseOut={e => e.currentTarget.style.background="transparent"}>
                    <td style={{ padding:"10px 12px", fontWeight:500, color:BRAND_DARK }}>{a.name}</td>
                    <td style={{ padding:"10px 12px", color:TEXT_SUB }}>{a.dept}</td>
                    <td style={{ padding:"10px 12px", fontWeight:600 }}><Dot k="avg_qa_score" v={a.qa} />{a.qa}%</td>
                    <td style={{ padding:"10px 12px", color:a.trend.startsWith("+")?GREEN:RED, fontWeight:500 }}>{a.trend}</td>
                    <td style={{ padding:"10px 12px" }}><span style={{ color: a.cadence >= a.expected ? GREEN : a.cadence >= a.expected * 0.75 ? ORANGE : RED, fontWeight:600 }}>{a.cadence}/{a.expected}</span></td>
                    <td style={{ padding:"10px 12px" }}><Dot k="avg_quiz_score" v={a.quiz} />{a.quiz}%</td>
                    <td style={{ padding:"10px 12px" }}>{a.coaching}</td>
                    <td style={{ padding:"10px 12px" }}>{a.disputes > 0 ? <Badge val={a.disputes} /> : "0"}</td>
                    <td style={{ padding:"10px 12px" }}>{a.writeups > 0 ? <Badge val={a.writeups} /> : "0"}</td>
                    <td style={{ padding:"10px 12px" }}>{a.risk ? <Badge val="At Risk" /> : <Badge val="OK" good />}</td>
                  </tr>
                ))}</tbody>
              </table>
            </Section>
          </>}

          {/* ═══ AGENT PROFILE ═══ */}
          {view === V.AGENT && agent && (() => {
            const agentWriteUps = writeUpMockData.filter(w => w.name === agent.name);
            const agentTopics = Object.entries(coachingTopicAgents).filter(([, agents]) => agents.some(a => a.name === agent.name)).map(([topic, agents]) => ({ topic, ...agents.find(a => a.name === agent.name) }));
            const agentReviews = agentFormReviews[agent.name] || [];
            const agentQuizzes = agentQuizDetails[agent.name] || [];
            const agentSessions = agentCoachingSessions[agent.name] || [];
            // Group reviews by form for summary line
            const formSummary = {};
            agentReviews.forEach(r => {
              if (!formSummary[r.form]) formSummary[r.form] = { form: r.form, scores: [], count: 0 };
              formSummary[r.form].scores.push(r.score);
              formSummary[r.form].count++;
            });
            Object.values(formSummary).forEach(f => { f.avg = +(f.scores.reduce((a,b)=>a+b,0)/f.scores.length).toFixed(1); });
            const agentForms = Object.values(formSummary);
            // Compute topic counts for coaching repeat detection
            const topicCounts = {};
            agentSessions.forEach(s => s.topics.forEach(t => { topicCounts[t] = (topicCounts[t]||0) + 1; }));
            // Mock prior period values for agent tiles
            const aPrior = { qa: +(agent.qa - parseFloat(agent.trend)).toFixed(1), quiz: +(agent.quiz - (Math.random()*4-1)).toFixed(1) };
            return <>
            <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:4 }}>
              <button onClick={() => setView(V.AGENTS)} style={{ background:"none", border:`1px solid ${BORDER}`, borderRadius:6, padding:"4px 10px", cursor:"pointer", fontSize:12, color:TEXT_SUB }}>← Back</button>
              <h2 style={{ fontSize:20, fontWeight:700 }}>{agent.name}</h2>
              {agent.risk && <Badge val="At Risk" />}
            </div>
            <p style={{ fontSize:13, color:TEXT_SUB, marginBottom:20 }}>{agent.dept} · {timeDisplay}</p>

            {/* ── HEADLINE TILES with trends ── */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(6,1fr)", gap:12, marginBottom:20 }}>
              {[
                { l:"QA Score", v:agent.qa, pv:aPrior.qa, c:getColor("avg_qa_score", agent.qa), fmt:"PCT" },
                { l:"Trend", v:agent.trend, c:agent.trend.startsWith("+")?GREEN:RED },
                { l:"Cadence", v:`${agent.cadence}/${agent.expected}`, c:agent.cadence>=agent.expected?GREEN:agent.cadence>=agent.expected*0.75?ORANGE:RED },
                { l:"Quiz Score", v:agent.quiz, pv:aPrior.quiz, c:agent.quiz>=80?GREEN:agent.quiz>=70?ORANGE:RED, fmt:"PCT" },
                { l:"Disputes", v:agent.disputes, c:agent.disputes===0?GREEN:agent.disputes>=3?RED:ORANGE },
                { l:"Write-Ups", v:agent.writeups, c:agent.writeups===0?GREEN:RED },
              ].map((c, i) => {
                const delta = (c.pv != null && typeof c.v === "number") ? +(c.v - c.pv).toFixed(1) : null;
                return (
                  <div key={i} style={{ background:CARD, border:`1px solid ${BORDER}`, borderRadius:10, padding:"14px 16px", textAlign:"center" }}>
                    <div style={{ fontSize:11, color:TEXT_SUB, marginBottom:4 }}>{c.l}</div>
                    <div style={{ display:"flex", alignItems:"baseline", justifyContent:"center", gap:6 }}>
                      <div style={{ fontSize:22, fontWeight:700, color:c.c }}>{c.fmt==="PCT" ? `${c.v}%` : c.v}</div>
                      {delta != null && delta !== 0 && <span style={{ fontSize:10, fontWeight:600, color:delta > 0 ? GREEN : RED }}>
                        {delta > 0 ? "▲" : "▼"}{Math.abs(delta)}{c.fmt==="PCT"?"%":""}
                      </span>}
                    </div>
                    {delta != null && <div style={{ fontSize:9, color:TEXT_SUB, marginTop:1 }}>vs prior period</div>}
                  </div>
                );
              })}
            </div>

            {/* ══ SECTION 1: QUALITY ══ */}
            <div style={{ fontSize:14, fontWeight:700, color:TEXT, marginBottom:8, paddingBottom:4, borderBottom:`2px solid ${BRAND}` }}>Quality</div>

            <div style={{ display:"grid", gridTemplateColumns:"1.5fr 1fr", gap:16, marginBottom:16 }}>
              <Section title="QA Score Trend">
                <Chart data={trendData.map(d => ({ ...d, qa:d.qa + (Math.random()*6-3) }))} dk="qa" color={BRAND} h={100} gv={90} label="QA Score" />
                <div style={{ marginTop:12 }}>
                  <Stat label="Total Evaluations (Period)" value="18" />
                  <Stat label="Highest Score" value="96.5%" color={GREEN} />
                  <Stat label="Lowest Score" value="72.1%" color={RED} />
                  <Stat label="Critical Fails" value={agent.qa < 80 ? "2" : "0"} color={agent.qa < 80 ? RED : GREEN} />
                </div>
              </Section>
              <Section title="Dispute Activity">
                <Stat label="Total Disputes Filed" value={String(agent.disputes)} color={agent.disputes > 0 ? ORANGE : GREEN} />
                <Stat label="Upheld (Agent Correct)" value={agent.disputes > 1 ? "1" : "0"} color={agent.disputes > 1 ? ORANGE : TEXT} />
                <Stat label="Rejected" value={agent.disputes > 2 ? "1" : "0"} />
                <Stat label="Adjusted (Auditor Error)" value={agent.disputes > 0 ? "1" : "0"} color={agent.disputes > 0 ? ORANGE : TEXT} />
                <Stat label="Avg Resolution Time" value="2.8 days" />
              </Section>
            </div>

            {/* ── Forms Performance with caret drill-down showing individual reviews ── */}
            <Section title="Forms Performance">
              <p style={{ fontSize:12, color:TEXT_SUB, marginBottom:10 }}>All QA evaluations for this agent in the period. Click a form to see individual review scores.</p>
              {Object.values(formSummary).map((f, fi) => {
                const isExpanded = expandedAgentForm === f.form;
                const reviews = agentReviews.filter(r => r.form === f.form);
                return (
                  <div key={fi} style={{ marginBottom:isExpanded ? 16 : 8 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 6px", cursor:"pointer", borderBottom:`1px solid ${BORDER}` }}
                      onClick={() => setExpandedAgentForm(isExpanded ? null : f.form)}
                      onMouseOver={e => e.currentTarget.style.background=BLUE_LIGHT}
                      onMouseOut={e => e.currentTarget.style.background="transparent"}>
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <span style={{ fontSize:10, color:TEXT_SUB }}>{isExpanded ? "▼" : "▶"}</span>
                        <span style={{ fontWeight:500, fontSize:13 }}>{f.form}</span>
                      </div>
                      <div style={{ display:"flex", alignItems:"center", gap:16, fontSize:12 }}>
                        <span style={{ fontWeight:600, color: f.avg >= 85 ? GREEN : f.avg >= 75 ? ORANGE : RED }}>Avg: {f.avg}%</span>
                        <span style={{ color:TEXT_SUB }}>{f.count} reviews</span>
                      </div>
                    </div>
                    {isExpanded && (
                      <div style={{ background:"#f8fafc", border:`1px solid ${BORDER}`, borderTop:"none", padding:"10px 14px", borderRadius:"0 0 8px 8px" }}>
                        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                          <thead><tr style={{ borderBottom:`1px solid ${BORDER}` }}>
                            {["Review Date","Call Date","Score"].map(h => <th key={h} style={{ padding:"4px 8px", textAlign:"left", fontSize:10, fontWeight:600, color:TEXT_SUB }}>{h}</th>)}
                          </tr></thead>
                          <tbody>{reviews.map((r, ri) => (
                            <tr key={ri} style={{ borderBottom:`1px solid ${BORDER}` }}>
                              <td style={{ padding:"6px 8px" }}>{r.reviewDate}</td>
                              <td style={{ padding:"6px 8px", color:TEXT_SUB }}>{r.callDate}</td>
                              <td style={{ padding:"6px 8px", fontWeight:600, color: r.score >= 85 ? GREEN : r.score >= 75 ? ORANGE : RED }}>{r.score}%</td>
                            </tr>
                          ))}</tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
              {Object.keys(formSummary).length === 0 && <div style={{ padding:"8px 0", fontSize:12, color:TEXT_SUB }}>No QA evaluations this period.</div>}
            </Section>

            {/* ── Category Performance with Forms column ── */}
            <Section title={`Category Performance — ${form}`}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                <thead><tr style={{ borderBottom:`2px solid ${BORDER}` }}>
                  {["Category","Form","Agent Score","Dept Avg","Goal","Trend","Status"].map(h => <th key={h} style={{ padding:"8px 12px", textAlign:"left", fontSize:11, fontWeight:600, color:TEXT_SUB }}>{h}</th>)}
                </tr></thead>
                <tbody>{cats.map((c, i) => {
                  const as = +(c.score + (Math.random()*10-5)).toFixed(1);
                  const catForm = agentForms.length > 0 ? agentForms[0].form : form;
                  return (
                    <tr key={i} style={{ borderBottom:`1px solid ${BORDER}` }}>
                      <td style={{ padding:"10px 12px", fontWeight:500 }}>{c.cat}</td>
                      <td style={{ padding:"10px 12px", fontSize:11, color:TEXT_SUB }}>{catForm}</td>
                      <td style={{ padding:"10px 12px", fontWeight:600, color: as >= c.goal ? GREEN : as >= c.goal - 10 ? ORANGE : RED }}>{as}%</td>
                      <td style={{ padding:"10px 12px", color:TEXT_SUB }}>{c.score}%</td>
                      <td style={{ padding:"10px 12px", color:TEXT_SUB }}>{c.goal}%</td>
                      <td style={{ padding:"10px 12px", color:c.trend.startsWith("+")?GREEN:RED }}>{c.trend}</td>
                      <td style={{ padding:"10px 12px" }}><Badge val={as>=c.goal?"On Target":"Below Goal"} good={as>=c.goal} /></td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </Section>

            {/* ══ SECTION 2: COACHING ══ */}
            <div style={{ fontSize:14, fontWeight:700, color:TEXT, marginBottom:8, paddingBottom:4, borderBottom:`2px solid ${PURPLE}`, marginTop:8 }}>Coaching</div>

            <Section title="Coaching Summary">
              <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:16 }}>
                <div style={{ textAlign:"center" }}>
                  <div style={{ fontSize:10, color:TEXT_SUB }}>Cadence</div>
                  <div style={{ fontSize:18, fontWeight:700, color:agent.cadence>=agent.expected?GREEN:agent.cadence>=agent.expected*0.75?ORANGE:RED }}>{agent.cadence}/{agent.expected}</div>
                </div>
                <div style={{ textAlign:"center" }}>
                  <div style={{ fontSize:10, color:TEXT_SUB }}>Total Sessions</div>
                  <div style={{ fontSize:18, fontWeight:700 }}>{agentSessions.length}</div>
                </div>
                <div style={{ textAlign:"center" }}>
                  <div style={{ fontSize:10, color:TEXT_SUB }}>Completed</div>
                  <div style={{ fontSize:18, fontWeight:700, color:GREEN }}>{agentSessions.filter(s=>s.status==="COMPLETED").length}</div>
                </div>
                <div style={{ textAlign:"center" }}>
                  <div style={{ fontSize:10, color:TEXT_SUB }}>Pending</div>
                  <div style={{ fontSize:18, fontWeight:700, color:ORANGE }}>{agentSessions.filter(s=>s.status==="PENDING").length}</div>
                </div>
              </div>

              {/* Session list with date and topics */}
              <div style={{ fontSize:13, fontWeight:600, marginBottom:8 }}>Coaching Sessions</div>
              {agentSessions.length > 0 ? (
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                  <thead><tr style={{ borderBottom:`1px solid ${BORDER}` }}>
                    {["Date","Topics Covered","Status"].map(h => <th key={h} style={{ padding:"4px 8px", textAlign:"left", fontSize:10, fontWeight:600, color:TEXT_SUB }}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {agentSessions.map((s, si) => (
                      <tr key={si} style={{ borderBottom:`1px solid ${BORDER}` }}>
                        <td style={{ padding:"6px 8px", fontWeight:500 }}>{s.date}</td>
                        <td style={{ padding:"6px 8px" }}>
                          {s.topics.map((t, ti) => (
                            <span key={ti} style={{ display:"inline-block", marginRight:6, marginBottom:2 }}>
                              <span style={{ fontWeight:500 }}>{t}</span>
                              {topicCounts[t] >= 2 && <span style={{ fontSize:10, fontWeight:600, color:RED, marginLeft:4 }}>({topicCounts[t]}× in period)</span>}
                              {ti < s.topics.length - 1 && <span style={{ color:TEXT_SUB }}>, </span>}
                            </span>
                          ))}
                        </td>
                        <td style={{ padding:"6px 8px" }}>
                          {s.status === "COMPLETED" ? <Badge val="Completed" good /> : <Badge val="Pending" />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <div style={{ padding:"8px 0", fontSize:12, color:GREEN }}>No coaching sessions this period.</div>}

              {/* Topic frequency summary */}
              {Object.keys(topicCounts).length > 0 && <>
                <div style={{ fontSize:13, fontWeight:600, marginTop:16, marginBottom:8 }}>Topic Frequency</div>
                {Object.entries(topicCounts).sort((a,b) => b[1] - a[1]).map(([topic, count], i) => (
                  <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"5px 0", borderBottom:`1px solid ${BORDER}`, fontSize:12 }}>
                    <span style={{ fontWeight:500 }}>{topic}</span>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <span style={{ fontWeight:600, color: count >= 3 ? RED : count >= 2 ? ORANGE : TEXT }}>{count}×</span>
                      {count >= 2 ? <Badge val="Repeat" /> : <Badge val="First" good />}
                    </div>
                  </div>
                ))}
              </>}
            </Section>

            {/* ── Quiz Performance with drill-down ── */}
            <Section title="Quiz Performance">
              <div style={{ display:"flex", gap:16, marginBottom:12 }}>
                <Stat label="Quiz Score" value={`${agent.quiz}%`} color={agent.quiz >= 80 ? GREEN : agent.quiz >= 70 ? ORANGE : RED} />
                <Stat label="Pass Rate" value={agent.quiz >= 80 ? "83%" : agent.quiz >= 70 ? "67%" : "50%"} color={agent.quiz >= 80 ? GREEN : agent.quiz >= 70 ? ORANGE : RED} />
                <Stat label="Avg Attempts" value={agent.quiz >= 80 ? "1.1" : agent.quiz >= 70 ? "1.6" : "2.2"} color={agent.quiz >= 80 ? GREEN : ORANGE} />
              </div>
              <p style={{ fontSize:12, color:TEXT_SUB, marginBottom:8 }}>Click to expand quiz details.</p>
              {agentQuizzes.length > 0 ? agentQuizzes.map((q, qi) => {
                const isExpQ = expandedAgentQuiz === q.quiz;
                return (
                  <div key={qi} style={{ marginBottom:4 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 6px", cursor:"pointer", borderBottom:`1px solid ${BORDER}` }}
                      onClick={() => setExpandedAgentQuiz(isExpQ ? null : q.quiz)}
                      onMouseOver={e => e.currentTarget.style.background=BLUE_LIGHT}
                      onMouseOut={e => e.currentTarget.style.background="transparent"}>
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <span style={{ fontSize:10, color:TEXT_SUB }}>{isExpQ ? "▼" : "▶"}</span>
                        <span style={{ fontWeight:500, fontSize:13 }}>{q.quiz}</span>
                      </div>
                      <div style={{ display:"flex", alignItems:"center", gap:12, fontSize:12 }}>
                        <span style={{ fontWeight:600, color:q.passed ? GREEN : RED }}>{q.score}%</span>
                        {q.passed ? <Badge val="Passed" good /> : <Badge val="Failed" />}
                      </div>
                    </div>
                    {isExpQ && (
                      <div style={{ background:"#f8fafc", border:`1px solid ${BORDER}`, borderTop:"none", padding:"10px 14px", borderRadius:"0 0 8px 8px", fontSize:12 }}>
                        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:12 }}>
                          <div><span style={{ color:TEXT_SUB }}>Score:</span> <span style={{ fontWeight:600, color:q.score>=80?GREEN:q.score>=65?ORANGE:RED }}>{q.score}%</span></div>
                          <div><span style={{ color:TEXT_SUB }}>Attempts:</span> <span style={{ fontWeight:600, color:q.attempts>1?ORANGE:GREEN }}>{q.attempts}</span></div>
                          <div><span style={{ color:TEXT_SUB }}>Date:</span> <span>{q.date}</span></div>
                          <div><span style={{ color:TEXT_SUB }}>Result:</span> {q.passed ? <span style={{ color:GREEN, fontWeight:600 }}>Pass</span> : <span style={{ color:RED, fontWeight:600 }}>Fail</span>}</div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              }) : <div style={{ padding:"8px 0", fontSize:12, color:GREEN }}>No quiz attempts this period.</div>}
            </Section>

            {/* ══ SECTION 3: PERFORMANCE WARNINGS ══ */}
            <div style={{ fontSize:14, fontWeight:700, color:TEXT, marginBottom:8, paddingBottom:4, borderBottom:`2px solid ${RED}`, marginTop:8 }}>Performance Warnings</div>

            {agentWriteUps.length > 0 ? (
              <Section title="Write-Up History">
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                  <thead><tr style={{ borderBottom:`2px solid ${BORDER}` }}>
                    {["Type","Status","Created","Meeting","Follow-Up","Manager","Prior","Coaching Linked","Policies"].map(h => <th key={h} style={{ padding:"6px 8px", textAlign:"left", fontSize:10, fontWeight:600, color:TEXT_SUB }}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {agentWriteUps.map((w, i) => {
                      const typeColors = { VERBAL_WARNING: YELLOW, WRITTEN_WARNING: ORANGE, FINAL_WARNING: RED };
                      const typeLabels = { VERBAL_WARNING: "Verbal", WRITTEN_WARNING: "Written", FINAL_WARNING: "Final" };
                      const statusLabels = { DRAFT: "Draft", SCHEDULED: "Scheduled", DELIVERED: "Delivered", AWAITING_SIGNATURE: "Awaiting Sig.", SIGNED: "Signed", FOLLOW_UP_PENDING: "Follow-Up", CLOSED: "Closed" };
                      const statusColors = { DRAFT: TEXT_SUB, SCHEDULED: PURPLE, DELIVERED: BRAND, AWAITING_SIGNATURE: ORANGE, SIGNED: YELLOW, FOLLOW_UP_PENDING: RED, CLOSED: GREEN };
                      return (
                        <tr key={i} style={{ borderBottom:`1px solid ${BORDER}` }}>
                          <td style={{ padding:"8px 8px" }}>
                            <span style={{ display:"inline-block", padding:"2px 8px", borderRadius:4, fontSize:11, fontWeight:600, background:typeColors[w.type]+"22", color:typeColors[w.type] }}>{typeLabels[w.type]}</span>
                          </td>
                          <td style={{ padding:"8px 8px" }}>
                            <span style={{ display:"inline-block", padding:"2px 8px", borderRadius:4, fontSize:11, fontWeight:600, background:statusColors[w.status]+"22", color:statusColors[w.status] }}>{statusLabels[w.status]}</span>
                          </td>
                          <td style={{ padding:"8px 8px", fontSize:11, color:TEXT_SUB }}>{w.created}</td>
                          <td style={{ padding:"8px 8px", fontSize:11, color:TEXT_SUB }}>{w.meetingDate || "—"}</td>
                          <td style={{ padding:"8px 8px", fontSize:11, color: w.followUpDate ? ORANGE : TEXT_SUB }}>{w.followUpDate || "—"}</td>
                          <td style={{ padding:"8px 8px", fontSize:11 }}>{w.manager}</td>
                          <td style={{ padding:"8px 8px", fontWeight:600, color: w.priorCount > 0 ? RED : GREEN }}>{w.priorCount}</td>
                          <td style={{ padding:"8px 8px" }}>{w.linkedCoaching ? <span style={{ color:GREEN, fontWeight:600 }}>✓</span> : <span style={{ color:RED, fontWeight:600 }}>✗</span>}</td>
                          <td style={{ padding:"8px 8px", fontSize:10, color:TEXT_SUB }}>{w.policies.join(", ")}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div style={{ marginTop:12 }}>
                  <Stat label="Total Write-Ups (Period)" value={String(agentWriteUps.length)} color={agentWriteUps.length > 0 ? ORANGE : GREEN} />
                  <Stat label="Pending Follow-Ups" value={String(agentWriteUps.filter(w => w.status === "FOLLOW_UP_PENDING").length)} color={ORANGE} />
                  <Stat label="Policies Cited" value={[...new Set(agentWriteUps.flatMap(w => w.policies))].join(", ")} />
                </div>
              </Section>
            ) : (
              <Section title="Write-Up History">
                <div style={{ padding:"20px 0", textAlign:"center" }}>
                  <div style={{ fontSize:28, marginBottom:8 }}>✓</div>
                  <div style={{ color:GREEN, fontSize:14, fontWeight:600 }}>No write-ups on record</div>
                  <div style={{ fontSize:12, color:TEXT_SUB, marginTop:4 }}>This agent has no performance warnings for the selected period.</div>
                </div>
                <div style={{ marginTop:8 }}>
                  <Stat label="Prior Write-Ups (All Time)" value="0" color={GREEN} />
                  <Stat label="Current Status" value="Clean Record" color={GREEN} />
                </div>
              </Section>
            )}
          </>;
          })()}
          </div>
        </div>
      </div>
    </div>
  );
}
