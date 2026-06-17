-- ─────────────────────────────────────────────────────────────────────────────
-- Agent Activity - Sales — KPI registry, page registry, and role access
--
-- Purely additive: only INSERTs into existing ie_kpi / ie_kpi_threshold /
-- ie_page / ie_page_role_access tables. No schema change. Registers the new
-- "Agent Activity - Sales" Insights section (5 report pages) so they surface
-- in navigation and the admin Insights Pages screen, gated by the same
-- ie_page_role_access machinery as every other Insights page.
--
-- All KPIs are seeded as DERIVED placeholders for the Phase 1 UI; the data
-- layer (fact tables + ingestion) lands in Phase 2. Source notes point at the
-- systems the data is sourced from (CRM / phone / mail), not final tables.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Step 1: KPI Definitions ──────────────────────────────────────────────────

INSERT INTO ie_kpi (kpi_code, kpi_name, description, category, formula_type, formula, source_table, format_type, decimal_places, direction, is_active, sort_order) VALUES
-- Call Activity
('aa_inbound_calls',     'Inbound Calls',      'Total inbound calls handled by the agent in the period.',                         'Agent Activity', 'DERIVED', 'SUM(call_count) WHERE call_direction = Inbound',  'call activity (source phone system)', 'NUMBER',   0, 'NEUTRAL',      1, 101),
('aa_outbound_calls',    'Outbound Calls',     'Total outbound calls placed by the agent in the period.',                         'Agent Activity', 'DERIVED', 'SUM(call_count) WHERE call_direction = Outbound', 'call activity (source phone system)', 'NUMBER',   0, 'NEUTRAL',      1, 102),
('aa_total_calls',       'Total Calls',        'Total calls (inbound + outbound) handled by the agent in the period.',            'Agent Activity', 'DERIVED', 'SUM(call_count)',                                'call activity (source phone system)', 'NUMBER',   0, 'UP_IS_GOOD',   1, 103),
('aa_total_talk_minutes','Talk Minutes',       'Total talk minutes across all calls in the period.',                              'Agent Activity', 'DERIVED', 'SUM(call_mins)',                                 'call activity (source phone system)', 'NUMBER',   0, 'NEUTRAL',      1, 104),
('aa_avg_handle_time',   'Avg Handle Time',    'Average minutes per call (talk minutes / total calls).',                          'Agent Activity', 'DERIVED', 'SUM(call_mins) / SUM(call_count)',               'call activity (source phone system)', 'NUMBER',   1, 'DOWN_IS_GOOD', 1, 105),
-- Leads
('aa_total_leads',       'Total Leads',        'Total leads generated for the salesperson in the period.',                        'Agent Activity', 'DERIVED', 'SUM(lead_total)',                                'lead / sales margin (source CRM)',    'NUMBER',   0, 'UP_IS_GOOD',   1, 111),
('aa_total_conversions', 'Total Conversions',  'Total converted leads in the period.',                                            'Agent Activity', 'DERIVED', 'SUM(lead_converted_total)',                      'lead / sales margin (source CRM)',    'NUMBER',   0, 'UP_IS_GOOD',   1, 112),
('aa_conversion_rate',   'Lead Conversion %',  'Percentage of leads that converted in the period.',                               'Agent Activity', 'DERIVED', '(total_conversions / total_leads) * 100',        'lead / sales margin (source CRM)',    'PERCENT',  1, 'UP_IS_GOOD',   1, 113),
('aa_total_subs',        'Total Subs',         'Total subscriptions sold in the period.',                                         'Agent Activity', 'DERIVED', 'SUM(order_sub_count)',                           'lead / sales margin (source CRM)',    'NUMBER',   0, 'UP_IS_GOOD',   1, 114),
('aa_sub_pace',          'Sub Pace',           'Projected subs for the full period based on the current daily run rate.',         'Agent Activity', 'DERIVED', '(total_subs / business_days_elapsed) * business_days_in_period', 'lead / sales margin (source CRM)', 'NUMBER', 0, 'UP_IS_GOOD', 1, 115),
('aa_sub_only_pct',      'Sub Only %',         'Share of subs that were sub-only deals (no product order).',                      'Agent Activity', 'DERIVED', '(sub_only_total / total_subs) * 100',            'lead / sales margin (source CRM)',    'PERCENT',  1, 'NEUTRAL',      1, 116),
-- Margin
('aa_product_margin',    'Product Margin',     'Total product margin for the salesperson in the period.',                         'Agent Activity', 'DERIVED', 'SUM(product_margin)',                            'sales margin (source CRM)',           'CURRENCY', 0, 'UP_IS_GOOD',   1, 121),
('aa_warranty_margin',   'Warranty Margin',    'Total warranty margin for the salesperson in the period.',                        'Agent Activity', 'DERIVED', 'SUM(warranty_margin)',                           'sales margin (source CRM)',           'CURRENCY', 0, 'UP_IS_GOOD',   1, 122),
('aa_total_margin',      'Total Margin',       'Total adjusted margin for the salesperson in the period.',                        'Agent Activity', 'DERIVED', 'SUM(margin)',                                    'sales margin (source CRM)',           'CURRENCY', 0, 'UP_IS_GOOD',   1, 123),
('aa_margin_pace',       'Margin Pace',        'Projected total margin for the full period based on the current daily run rate.', 'Agent Activity', 'DERIVED', '(total_margin / business_days_elapsed) * business_days_in_period', 'sales margin (source CRM)',  'CURRENCY', 0, 'UP_IS_GOOD',   1, 124),
('aa_margin_per_deal',   'Margin / Deal',      'Average total margin per deal.',                                                  'Agent Activity', 'DERIVED', 'total_margin / deals_count',                     'sales margin (source CRM)',           'CURRENCY', 0, 'UP_IS_GOOD',   1, 125),
('aa_warranty_close_rate','Warranty Close Rate','Share of deals that included a warranty.',                                       'Agent Activity', 'DERIVED', '(warranty_deals / deals_count) * 100',           'sales margin (source CRM)',           'PERCENT',  0, 'UP_IS_GOOD',   1, 126),
-- Tickets & Tasks
('aa_tickets_created',   'Tickets Created',    'Tickets/tasks created and assigned to the agent in the period.',                  'Agent Activity', 'DERIVED', 'COUNT(tickets) WHERE created_on IN range',       'ticket / task (source CRM)',          'NUMBER',   0, 'NEUTRAL',      1, 131),
('aa_tickets_closed',    'Tickets Closed',     'Tickets/tasks closed by the agent in the period.',                                'Agent Activity', 'DERIVED', 'COUNT(tickets) WHERE closed_on IN range',        'ticket / task (source CRM)',          'NUMBER',   0, 'UP_IS_GOOD',   1, 132),
('aa_tickets_open',      'Open Tickets',       'Tickets/tasks still open at the end of the period.',                              'Agent Activity', 'DERIVED', 'COUNT(tickets) WHERE status != Closed',          'ticket / task (source CRM)',          'NUMBER',   0, 'DOWN_IS_GOOD', 1, 133),
('aa_tickets_past_due',  'Past Due',           'Open tickets/tasks that are past their due date.',                                'Agent Activity', 'DERIVED', 'COUNT(tickets) WHERE past_due_current = Past Due','ticket / task (source CRM)',          'NUMBER',   0, 'DOWN_IS_GOOD', 1, 134),
('aa_avg_days_to_close', 'Avg Days to Close',  'Average days between ticket creation and closure.',                               'Agent Activity', 'DERIVED', 'AVG(DATEDIFF(closed_on, created_on))',           'ticket / task (source CRM)',          'NUMBER',   1, 'DOWN_IS_GOOD', 1, 135),
-- Email Activity
('aa_inbound_emails',    'Inbound Emails',     'Inbound emails handled by the agent in the period.',                              'Agent Activity', 'DERIVED', 'SUM(email_count) WHERE email_direction = Inbound','email stats (source mail system)',    'NUMBER',   0, 'NEUTRAL',      1, 141),
('aa_outbound_emails',   'Outbound Emails',    'Outbound emails sent by the agent in the period.',                                'Agent Activity', 'DERIVED', 'SUM(email_count) WHERE email_direction = Outbound','email stats (source mail system)',   'NUMBER',   0, 'NEUTRAL',      1, 142),
('aa_internal_emails',   'Internal Emails',    'Internal emails for the agent in the period.',                                    'Agent Activity', 'DERIVED', 'SUM(email_count) WHERE email_direction = Internal','email stats (source mail system)',   'NUMBER',   0, 'NEUTRAL',      1, 143),
('aa_total_emails',      'Total Emails',       'Total emails (inbound + outbound + internal) for the agent in the period.',       'Agent Activity', 'DERIVED', 'SUM(email_count)',                               'email stats (source mail system)',    'NUMBER',   0, 'UP_IS_GOOD',   1, 144);

-- ── Step 2: Default Thresholds (only KPIs with goal semantics) ────────────────

INSERT INTO ie_kpi_threshold (kpi_id, department_key, goal_value, warning_value, critical_value, effective_from)
SELECT id, NULL,
  CASE kpi_code WHEN 'aa_conversion_rate' THEN 30 ELSE NULL END,
  CASE kpi_code WHEN 'aa_conversion_rate' THEN 20 ELSE NULL END,
  CASE kpi_code WHEN 'aa_conversion_rate' THEN 10 ELSE NULL END,
  CURDATE()
FROM ie_kpi WHERE kpi_code IN ('aa_conversion_rate');

-- ── Step 3: Page Registry — section "Agent Activity - Sales", 5 report pages ──

INSERT INTO ie_page (page_key, page_name, description, category, route_path, icon, sort_order, is_active, requires_section) VALUES
('aa_sales_call',    'Call Activity',    'Inbound/outbound call volume and talk time by agent.',          'Agent Activity - Sales', '/app/insights/aa-call',    'Phone',          1, 1, 'insights'),
('aa_sales_leads',   'Leads',            'Leads, conversions, and subscription performance by salesperson.','Agent Activity - Sales', '/app/insights/aa-leads',   'Target',         2, 1, 'insights'),
('aa_sales_margin',  'Margin',           'Product, warranty, and total margin by salesperson.',           'Agent Activity - Sales', '/app/insights/aa-margin',  'DollarSign',     3, 1, 'insights'),
('aa_sales_tickets', 'Tickets & Tasks',  'Ticket and task volume, closures, and aging by agent.',         'Agent Activity - Sales', '/app/insights/aa-tickets', 'Ticket',         4, 1, 'insights'),
('aa_sales_email',   'Email Activity',   'Inbound/outbound/internal email volume by agent.',              'Agent Activity - Sales', '/app/insights/aa-email',   'Mail',           5, 1, 'insights');

-- ── Step 4: Role Access — Admin(1) and Manager(5) → ALL scope ─────────────────

INSERT INTO ie_page_role_access (page_id, role_id, can_access, data_scope)
SELECT p.id, r.role_id, 1, r.data_scope
FROM ie_page p
JOIN (
  SELECT 'aa_sales_call'    pk, 1 role_id, 'ALL' data_scope UNION ALL
  SELECT 'aa_sales_call',    5,            'ALL'             UNION ALL
  SELECT 'aa_sales_leads',   1,            'ALL'             UNION ALL
  SELECT 'aa_sales_leads',   5,            'ALL'             UNION ALL
  SELECT 'aa_sales_margin',  1,            'ALL'             UNION ALL
  SELECT 'aa_sales_margin',  5,            'ALL'             UNION ALL
  SELECT 'aa_sales_tickets', 1,            'ALL'             UNION ALL
  SELECT 'aa_sales_tickets', 5,            'ALL'             UNION ALL
  SELECT 'aa_sales_email',   1,            'ALL'             UNION ALL
  SELECT 'aa_sales_email',   5,            'ALL'
) r ON p.page_key = r.pk;
