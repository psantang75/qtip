/**
 * Sample data for the Agent Activity - Sales report pages (Phase 1 UI only).
 * Numbers are illustrative so the layouts can be reviewed before the Phase 2
 * data layer (fact tables + ingestion from the source systems) is wired.
 * The shapes here intentionally mirror the columns of the legacy Insights
 * reports so swapping in live data later is a drop-in replacement.
 */

export interface TrendPoint { label: string; value: number }
export interface DualPoint { label: string; left: number; right: number }

/**
 * When the underlying data was last refreshed. Shown on every table/chart so
 * users know the data freshness. Phase 2 sources this from the ingestion log.
 */
export const DATA_LAST_UPDATED = '06-17-2026 11:12 AM'

/** Sales agents used across the section's sample data (also feeds the Agent filter). */
export const SAMPLE_AGENTS = [
  'Jamie Waldie', 'Levi Roose', 'Megan Foti', 'Mitchell Stempowski', 'Nick Robinson', 'Steven Selley',
]

const WEEKS = ['Wk 1', 'Wk 2', 'Wk 3', 'Wk 4', 'Wk 5', 'Wk 6', 'Wk 7', 'Wk 8']
const trend = (vals: number[]): TrendPoint[] => WEEKS.map((label, i) => ({ label, value: vals[i] }))

// ── Call Activity ─────────────────────────────────────────────────────────────

// Business days in the selected range. Sourced from the Business Calendar
// (/app/admin/insights/calendar) once the data layer lands in Phase 2.
export const callBusinessDays = 13

// Summary roll-up (Call Count Summary + Call Time Summary combined). These
// values back the KPI cards as well as the summary table.
export const callKpis: Record<string, number> = {
  aa_business_days:      callBusinessDays,
  aa_total_calls:        2809,
  aa_total_talk_minutes: 18452,
  aa_avg_calls_per_day:  216,   // 2809 / 13
  aa_avg_min_per_day:    1419,  // 18452 / 13
  aa_avg_handle_time:    6.6,   // 18452 / 2809
}

// Per-business-day series. left = period total, right = per-agent average.
const CALL_DAYS = ['Jun 1', 'Jun 2', 'Jun 3', 'Jun 4', 'Jun 5', 'Jun 8', 'Jun 9', 'Jun 10', 'Jun 11', 'Jun 12', 'Jun 15', 'Jun 16', 'Jun 17']
const CALL_DAY_TOTALS = [228, 240, 205, 252, 231, 198, 246, 219, 263, 215, 234, 222, 256]
const AGENT_COUNT = SAMPLE_AGENTS.length

export const callDailyCalls: DualPoint[] = CALL_DAYS.map((label, i) => ({
  label, left: CALL_DAY_TOTALS[i], right: Math.round(CALL_DAY_TOTALS[i] / AGENT_COUNT),
}))
export const callDailyMinutes: DualPoint[] = CALL_DAYS.map((label, i) => {
  const totalMin = Math.round(CALL_DAY_TOTALS[i] * 6.6)
  return { label, left: totalMin, right: Math.round(totalMin / AGENT_COUNT) }
})

// Call Activity Summary — one row per agent, totals across the selected period.
// Columns: Business Days, Total Calls, Avg Calls/Day, Total Min, Avg Min/Day, Avg Min/Call.
export interface CallSummaryRow {
  agent: string; businessDays: number; totalCalls: number; avgCallsPerDay: number
  totalMin: number; avgMinPerDay: number; avgMinPerCall: number
}
const summaryRow = (agent: string, inbound: number, outbound: number, totalMin: number): CallSummaryRow => {
  const totalCalls = inbound + outbound
  return {
    agent,
    businessDays:   callBusinessDays,
    totalCalls,
    avgCallsPerDay: +(totalCalls / callBusinessDays).toFixed(1),
    totalMin,
    avgMinPerDay:   +(totalMin / callBusinessDays).toFixed(1),
    avgMinPerCall:  +(totalMin / totalCalls).toFixed(1),
  }
}
export const callSummaryRows: CallSummaryRow[] = [
  summaryRow('Jamie Waldie',        412, 188, 3960),
  summaryRow('Levi Roose',          355, 142, 3180),
  summaryRow('Megan Foti',          298, 201, 3492),
  summaryRow('Mitchell Stempowski', 268, 156, 2630),
  summaryRow('Nick Robinson',       309, 180, 3300),
  summaryRow('Steven Selley',       200, 100, 1890),
]

// Grand-total row for the summary table (all agents combined). Business days is
// the period basis (not summed); per-day/per-call averages use the totals.
export const callSummaryTotal: CallSummaryRow = (() => {
  const totalCalls = callSummaryRows.reduce((s, r) => s + r.totalCalls, 0)
  const totalMin   = callSummaryRows.reduce((s, r) => s + r.totalMin, 0)
  return {
    agent: 'Total',
    businessDays:   callBusinessDays,
    totalCalls,
    avgCallsPerDay: +(totalCalls / callBusinessDays).toFixed(1),
    totalMin,
    avgMinPerDay:   +(totalMin / callBusinessDays).toFixed(1),
    avgMinPerCall:  +(totalMin / totalCalls).toFixed(1),
  }
})()

// Call Activity by Day — one row per agent per day.
// Columns: Inbound Calls, Outbound Calls, Total Calls, Inbound Min, Outbound Min, Total Min.
export interface CallByDayRow {
  agent: string; date: string; inbound: number; outbound: number; total: number
  inboundMin: number; outboundMin: number; totalMin: number
}
const byDay = (agent: string, date: string, inbound: number, outbound: number, inboundMin: number, outboundMin: number): CallByDayRow => ({
  agent, date, inbound, outbound, total: inbound + outbound,
  inboundMin, outboundMin, totalMin: inboundMin + outboundMin,
})
export const callByDayRows: CallByDayRow[] = [
  byDay('Jamie Waldie',        'Jun 15', 26, 11, 182, 62),
  byDay('Jamie Waldie',        'Jun 16', 25, 10, 172, 59),
  byDay('Jamie Waldie',        'Jun 17', 28, 12, 196, 68),
  byDay('Levi Roose',          'Jun 15', 21, 9,  138, 48),
  byDay('Levi Roose',          'Jun 16', 20, 8,  133, 46),
  byDay('Levi Roose',          'Jun 17', 22, 9,  147, 51),
  byDay('Megan Foti',          'Jun 15', 18, 12, 150, 57),
  byDay('Megan Foti',          'Jun 16', 17, 13, 152, 58),
  byDay('Megan Foti',          'Jun 17', 19, 14, 168, 63),
  byDay('Nick Robinson',       'Jun 15', 23, 12, 176, 62),
  byDay('Nick Robinson',       'Jun 16', 20, 10, 147, 51),
  byDay('Nick Robinson',       'Jun 17', 21, 11, 158, 56),
]

// Grouped view for the by-day table: each agent's daily rows followed by a
// bolded subtotal row ("Total - {agent}").
export interface CallByDayGroup {
  agent: string
  rows: CallByDayRow[]
  total: { inbound: number; outbound: number; total: number; inboundMin: number; outboundMin: number; totalMin: number }
}
const sum = (rows: CallByDayRow[], key: keyof CallByDayRow) =>
  rows.reduce((s, r) => s + (r[key] as number), 0)
export const callByDayGroups: CallByDayGroup[] = SAMPLE_AGENTS
  .map(agent => callByDayRows.filter(r => r.agent === agent))
  .filter(rows => rows.length > 0)
  .map(rows => ({
    agent: rows[0].agent,
    rows,
    total: {
      inbound:     sum(rows, 'inbound'),
      outbound:    sum(rows, 'outbound'),
      total:       sum(rows, 'total'),
      inboundMin:  sum(rows, 'inboundMin'),
      outboundMin: sum(rows, 'outboundMin'),
      totalMin:    sum(rows, 'totalMin'),
    },
  }))

// ── Leads ───────────────────────────────────────────────────────────────────

// Pace is projected over the full period using the run rate so far:
//   pace = value / business_days_elapsed * business_days_in_period
export const leadBusinessDaysElapsed = 13
const LEAD_BIZ_DAYS_TOTAL = 22

// Lead Conversions by Category and Lead Source — one row per (category, source).
export interface LeadCatSourceRow {
  category: string; source: string; totalLeads: number; conversions: number
  pctConverted: number; bizDaysElapsed: number; leadPace: number; conversionPace: number
}
const leadRow = (category: string, source: string, totalLeads: number, conversions: number): LeadCatSourceRow => ({
  category, source, totalLeads, conversions,
  pctConverted:   +(conversions / totalLeads * 100).toFixed(1),
  bizDaysElapsed: leadBusinessDaysElapsed,
  leadPace:       Math.round(totalLeads  / leadBusinessDaysElapsed * LEAD_BIZ_DAYS_TOTAL),
  conversionPace: Math.round(conversions / leadBusinessDaysElapsed * LEAD_BIZ_DAYS_TOTAL),
})
export const leadCatSourceRows: LeadCatSourceRow[] = [
  leadRow('New Business',      'Web',        210, 58),
  leadRow('New Business',      'Phone',      165, 47),
  leadRow('New Business',      'Referral',    98, 36),
  leadRow('New Business',      'Trade Show',  72, 19),
  leadRow('Existing Customer', 'Phone',      142, 51),
  leadRow('Existing Customer', 'Email',      120, 40),
  leadRow('Existing Customer', 'Web',         96, 28),
  leadRow('Reactivation',      'Email',       88, 21),
  leadRow('Reactivation',      'Referral',    64, 18),
  leadRow('Reactivation',      'Phone',       49, 14),
  // Low-volume sources (each < 3% of total) — these roll up into "Other" on the pie.
  leadRow('New Business',      'Live Chat',    9,  2),
  leadRow('Existing Customer', 'Webinar',      7,  3),
  leadRow('New Business',      'Direct Mail',  6,  1),
  leadRow('Reactivation',      'Partner',      5,  1),
]

// Distinct filter options (preserve first-seen order).
export const LEAD_CATEGORIES = [...new Set(leadCatSourceRows.map(r => r.category))]
export const LEAD_SOURCES     = [...new Set(leadCatSourceRows.map(r => r.source))]

// KPI card values — derived from the rows so the cards reconcile with the table.
export const leadKpis: Record<string, number> = (() => {
  const totalLeads  = leadCatSourceRows.reduce((s, r) => s + r.totalLeads, 0)
  const conversions = leadCatSourceRows.reduce((s, r) => s + r.conversions, 0)
  return {
    aa_total_leads:       totalLeads,
    aa_total_conversions: conversions,
    aa_conversion_rate:   +(conversions / totalLeads * 100).toFixed(1),
    aa_lead_pace:         Math.round(totalLeads  / leadBusinessDaysElapsed * LEAD_BIZ_DAYS_TOTAL),
    aa_conversion_pace:   Math.round(conversions / leadBusinessDaysElapsed * LEAD_BIZ_DAYS_TOTAL),
    aa_business_days:     leadBusinessDaysElapsed,
  }
})()

// ── Sales Margin ──────────────────────────────────────────────────────────────
// The Sales Margin report is four tables (no KPI cards / charts).

// Table 1 — Leads by Salesperson (Based on Lead Created Date)
export interface MarginLeadsRow { agent: string; totalLeads: number; totalConversions: number; conversionPct: number }
const mLead = (agent: string, totalLeads: number, totalConversions: number): MarginLeadsRow => ({
  agent, totalLeads, totalConversions, conversionPct: +(totalConversions / totalLeads * 100).toFixed(1),
})
export const marginLeadsRows: MarginLeadsRow[] = [
  mLead('Jamie Waldie',        158, 87),
  mLead('Megan Foti',          154, 91),
  mLead('Mitchell Stempowski', 208, 126),
  mLead('Steven Selley',       177, 142),
  mLead('Vince Deleon',        163, 97),
]

// Table 2 — Deals and Subscriptions by Salesperson (Based on Margin Eligibility Date)
export interface MarginDealsRow {
  agent: string; deals: number; totalSubs: number; subPace: number
  subOnlyDeals: number; subOnly: number; subOnlyPct: number
}
const mDeal = (agent: string, deals: number, totalSubs: number, subPace: number, subOnlyDeals: number, subOnly: number): MarginDealsRow => ({
  agent, deals, totalSubs, subPace, subOnlyDeals, subOnly, subOnlyPct: +(subOnly / totalSubs * 100).toFixed(1),
})
export const marginDealsRows: MarginDealsRow[] = [
  mDeal('Jamie Waldie',        91,  113, 113, 22, 26),
  mDeal('Megan Foti',          117, 145, 145, 22, 19),
  mDeal('Mitchell Stempowski', 142, 151, 151, 41, 46),
  mDeal('Steven Selley',       127, 115, 115, 24, 24),
  mDeal('Vince Deleon',        103, 121, 121, 18, 20),
]

// Table 3 — Margin by Salesperson
export interface MarginRow {
  agent: string; product: number; install: number; shipping: number; warranty: number
  total: number; pace: number; perDeal: number; perSub: number; warrantyPct: number; shippingPct: number
}
const mRow = (agent: string, product: number, install: number, shipping: number, warranty: number, deals: number, subs: number): MarginRow => {
  const total = product + install + shipping + warranty
  return {
    agent, product, install, shipping, warranty, total,
    pace: total,
    perDeal: +(total / deals).toFixed(2),
    perSub:  +(total / subs).toFixed(2),
    warrantyPct: +(warranty / total * 100).toFixed(0),
    shippingPct: +(shipping / total * 100).toFixed(0),
  }
}
export const marginRows: MarginRow[] = [
  mRow('Jamie Waldie',        16060.06, 6679.00, 1800.00, 5269.57, 91,  113),
  mRow('Vince Deleon',        10206.76, 8913.00, 1113.97, 3158.51, 103, 121),
  mRow('Mitchell Stempowski',  9670.96,  725.00, 2025.13, 3908.43, 142, 151),
  mRow('Megan Foti',           7331.88, 1137.50, 1140.00, 3499.41, 117, 145),
  mRow('Steven Selley',        4921.68, 1376.98,  710.00, 1199.80, 127, 115),
]

// Table 4 — Margin by Customer Leaderboard
export interface MarginCustomerRow {
  agent: string; customer: string; product: number; install: number; shipping: number
  warranty: number; total: number; deals: number; subs: number
}
const mCust = (agent: string, customer: string, product: number, install: number, shipping: number, warranty: number, deals: number, subs: number): MarginCustomerRow => ({
  agent, customer, product, install, shipping, warranty, total: product + install + shipping + warranty, deals, subs,
})
// A customer leaderboard — one salesperson can appear for several customers.
export const marginCustomerRows: MarginCustomerRow[] = [
  mCust('Vince Deleon',        'Forefront Management, LLC',                    2325.03, 3915.00, 238.92,    0.00, 16, 13),
  mCust('Vince Deleon',        'Solis Mammography',                           1581.51, 3465.00, 155.00,    0.00,  3,  2),
  mCust('Jamie Waldie',        "PGC Capital, LLC dba Dave's Hot Chicken",     1916.96, 2657.00, 225.00,    0.00,  3,  3),
  mCust('Jamie Waldie',        'PulteGroup - 1037 (Georgia Division)',        2636.79,    0.00, 240.00, 1334.79,  1, 24),
  mCust('Megan Foti',          'Mountain West Bank',                          1287.77,    0.00, 345.00, 1379.77,  2, 23),
  mCust('Vince Deleon',        'Springfield Regional Medical Center',         1625.37,    0.00,  45.39, 1139.81,  1,  0),
  mCust('Jamie Waldie',        "Mike's Red Tacos Corporate - Pasadena",       1291.88, 1351.00,  75.00,    0.00,  2,  2),
  mCust('Jamie Waldie',        "Rackson Cayenne, LLC dba Dave's Hot Chicken", 1157.82,    0.00, 105.00, 1124.99,  2,  1),
  mCust('Jamie Waldie',        "Hot North Chicken LLC dba Dave's Hot Chicken", 914.71,  728.00,  75.00,  610.99,  1,  1),
  mCust('Mitchell Stempowski', 'Baptist Health South Florida',               1151.88,    0.00, 280.00,  719.88,  1,  0),
  mCust('Megan Foti',          'Cedar & Co.',                                 1325.00,  450.00, 300.00,    0.00,  6,  7),
  mCust('Steven Selley',       'Northgate LLC',                                980.40,  220.00, 175.00,  410.00,  5,  5),
  mCust('Mitchell Stempowski', 'Harbor Point Co.',                            1180.75,    0.00, 220.10,  280.00,  4,  4),
  mCust('Steven Selley',       'Apex Distributors',                           1050.00,  300.00, 110.00,  150.00,  3,  3),
  mCust('Vince Deleon',        'Lakeside Dental Group',                        890.25,  380.00,  95.00,  210.00,  2,  2),
  mCust('Megan Foti',          'Riverbend Logistics',                          760.40,    0.00, 140.00,  560.00,  2,  6),
  mCust('Jamie Waldie',        'Summit Retail Group',                          720.50,  250.00, 130.00,  320.00,  2,  3),
  mCust('Mitchell Stempowski', 'Greenfield Partners',                          815.60,    0.00,  90.00,  410.00,  1,  1),
  mCust('Steven Selley',       'Cobalt Health Systems',                        690.00,  180.00,  60.00,  300.00,  1,  2),
  mCust('Megan Foti',          'Tri-State Auto Group',                         540.25,    0.00,  75.00,  480.00,  1,  4),
]

// ── Tickets & Tasks ─────────────────────────────────────────────────────────
// Tickets and Tasks by Agent — one row per (agent, classification), grouped with
// a bolded subtotal row per agent. Counts: Current (open), Due Today, Past Due.
export interface TicketRow { agent: string; classification: string; current: number; dueToday: number; pastDue: number }
export const ticketRows: TicketRow[] = [
  { agent: 'Jamie Waldie', classification: 'Activation Task - Sales',  current: 0,    dueToday: 0,  pastDue: 1 },
  { agent: 'Jamie Waldie', classification: 'Contact Manager',          current: 2777, dueToday: 0,  pastDue: 0 },
  { agent: 'Jamie Waldie', classification: 'Lead Manager',             current: 183,  dueToday: 12, pastDue: 0 },
  { agent: 'Jamie Waldie', classification: 'Order Flow Manager',       current: 23,   dueToday: 2,  pastDue: 0 },
  { agent: 'Jamie Waldie', classification: 'Sales',                    current: 1,    dueToday: 0,  pastDue: 0 },
  { agent: 'Jamie Waldie', classification: 'Sales Accounts Receivable', current: 19,  dueToday: 0,  pastDue: 2 },
  { agent: 'Jamie Waldie', classification: 'Shipping',                 current: 8,    dueToday: 0,  pastDue: 0 },
  { agent: 'Megan Foti',   classification: 'Activation Task - Sales',  current: 1,    dueToday: 0,  pastDue: 0 },
  { agent: 'Megan Foti',   classification: 'Contact Manager',          current: 3248, dueToday: 0,  pastDue: 4 },
  { agent: 'Megan Foti',   classification: 'Lead Manager',             current: 190,  dueToday: 11, pastDue: 1 },
  { agent: 'Megan Foti',   classification: 'Order Flow Manager',       current: 15,   dueToday: 1,  pastDue: 0 },
  { agent: 'Megan Foti',   classification: 'Sales',                    current: 2,    dueToday: 0,  pastDue: 0 },
  { agent: 'Megan Foti',   classification: 'Shipping',                 current: 6,    dueToday: 0,  pastDue: 0 },
  { agent: 'Nick Robinson', classification: 'Contact Manager',         current: 2105, dueToday: 0,  pastDue: 3 },
  { agent: 'Nick Robinson', classification: 'Lead Manager',            current: 142,  dueToday: 8,  pastDue: 0 },
  { agent: 'Nick Robinson', classification: 'Order Flow Manager',      current: 18,   dueToday: 1,  pastDue: 0 },
  { agent: 'Nick Robinson', classification: 'Sales',                   current: 3,    dueToday: 0,  pastDue: 0 },
  { agent: 'Nick Robinson', classification: 'Shipping',                current: 5,    dueToday: 0,  pastDue: 1 },
]
export interface TicketGroup {
  agent: string
  rows: TicketRow[]
  total: { current: number; dueToday: number; pastDue: number }
}
export const ticketGroups: TicketGroup[] = SAMPLE_AGENTS
  .map(agent => ticketRows.filter(r => r.agent === agent))
  .filter(rows => rows.length > 0)
  .map(rows => ({
    agent: rows[0].agent,
    rows,
    total: {
      current:  rows.reduce((s, r) => s + r.current, 0),
      dueToday: rows.reduce((s, r) => s + r.dueToday, 0),
      pastDue:  rows.reduce((s, r) => s + r.pastDue, 0),
    },
  }))

// ── Email Activity ────────────────────────────────────────────────────────────

// Email Activity Summary — one row per agent: total emails sent in the period.
export interface EmailSummaryRow { agent: string; totalSent: number }
export const emailSummaryRows: EmailSummaryRow[] = [
  { agent: 'Jamie Waldie',        totalSent: 788 },
  { agent: 'Levi Roose',          totalSent: 642 },
  { agent: 'Megan Foti',          totalSent: 601 },
  { agent: 'Mitchell Stempowski', totalSent: 540 },
  { agent: 'Nick Robinson',       totalSent: 619 },
  { agent: 'Steven Selley',       totalSent: 490 },
]
export const emailSummaryTotal: EmailSummaryRow = {
  agent: 'Total',
  totalSent: emailSummaryRows.reduce((s, r) => s + r.totalSent, 0),
}

// Email Activity by Agent — one row per agent per day, grouped with a bolded
// subtotal row ("Total - {agent}"), mirroring the Call Activity by Day table.
export interface EmailByDayRow { agent: string; date: string; totalSent: number }
export const emailByDayRows: EmailByDayRow[] = [
  { agent: 'Jamie Waldie', date: 'Jun 15', totalSent: 62 },
  { agent: 'Jamie Waldie', date: 'Jun 16', totalSent: 58 },
  { agent: 'Jamie Waldie', date: 'Jun 17', totalSent: 66 },
  { agent: 'Levi Roose',   date: 'Jun 15', totalSent: 50 },
  { agent: 'Levi Roose',   date: 'Jun 16', totalSent: 47 },
  { agent: 'Levi Roose',   date: 'Jun 17', totalSent: 53 },
  { agent: 'Megan Foti',   date: 'Jun 15', totalSent: 46 },
  { agent: 'Megan Foti',   date: 'Jun 16', totalSent: 48 },
  { agent: 'Megan Foti',   date: 'Jun 17', totalSent: 51 },
  { agent: 'Nick Robinson', date: 'Jun 15', totalSent: 49 },
  { agent: 'Nick Robinson', date: 'Jun 16', totalSent: 45 },
  { agent: 'Nick Robinson', date: 'Jun 17', totalSent: 52 },
]
export interface EmailByDayGroup {
  agent: string
  rows: EmailByDayRow[]
  total: { totalSent: number }
}
export const emailByDayGroups: EmailByDayGroup[] = SAMPLE_AGENTS
  .map(agent => emailByDayRows.filter(r => r.agent === agent))
  .filter(rows => rows.length > 0)
  .map(rows => ({
    agent: rows[0].agent,
    rows,
    total: { totalSent: rows.reduce((s, r) => s + r.totalSent, 0) },
  }))
