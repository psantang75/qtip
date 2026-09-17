/**
 * Missed Opportunities → downloadable Word document.
 *
 * Renders the exact report the page shows into a Word-openable HTML document
 * (`application/msword`, `.doc`). Word opens HTML-based `.doc` files natively,
 * so this needs no new dependency and mirrors the existing buffer-based export
 * pattern (build content → set headers → res.send) used by the analytics and
 * on-demand report exports.
 *
 * Findings are grouped agent → customer → call, matching the on-screen list.
 * The caller passes the already-scoped `MissedOpportunityResult`, so this file
 * is pure formatting: no DB access, no scope logic.
 */
import type {
  MissedOpportunityResult,
  MissedOpportunityFindingRow,
} from './insightsMissedOpportunities.service';

/** Mirror of frontend `utils/crmLinks.buildCrmUrl` — same host the page links to. */
function crmUrl(kind: 'TASK' | 'TICKET', externalId: number): string {
  return kind === 'TASK'
    ? `https://crm.dm-us.com/TaskManager/AccountsReceivableManager?TaskID=${externalId}`
    : `https://crm.dm-us.com/Tickets/Edit?CustomerID=0&JobID=0&TicketID=${externalId}`;
}

const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const escMultiline = (v: unknown): string => esc(v).replace(/\r?\n/g, '<br/>');

function fmtDayLong(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function talkMins(secs: number | null): string | null {
  if (secs == null) return null;
  return `${Math.round(secs / 60)} min`;
}

const SEVERITY_COLOR: Record<string, string> = {
  high: '#e74c3c',
  medium: '#f39c12',
  low: '#666666',
};

function severityChip(severity: string): string {
  const color = SEVERITY_COLOR[severity] ?? '#666666';
  return `<span style="color:${color};font-weight:bold;text-transform:uppercase;font-size:9pt">${esc(severity)}</span>`;
}

const SEVERITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

function customerLabel(f: MissedOpportunityFindingRow): string {
  const name = f.customerName?.trim();
  return name || 'Unknown caller';
}

function interactionKey(f: MissedOpportunityFindingRow): string {
  return f.conversationId ?? `anon:${f.callDate ?? f.findingId}`;
}

interface CustomerBucket {
  name: string;
  findings: MissedOpportunityFindingRow[];
  interactions: { key: string; findings: MissedOpportunityFindingRow[] }[];
}

/** Same grouping as the on-screen FindingsList: customer, then call, worst first. */
export function groupFindingsForExport(findings: MissedOpportunityFindingRow[]): CustomerBucket[] {
  const byCustomer = new Map<string, MissedOpportunityFindingRow[]>();
  for (const f of findings) {
    const key = customerLabel(f);
    const list = byCustomer.get(key);
    if (list) list.push(f);
    else byCustomer.set(key, [f]);
  }

  const byTime = (a: MissedOpportunityFindingRow, b: MissedOpportunityFindingRow) => {
    const ta = a.callDate ? Date.parse(a.callDate) : 0;
    const tb = b.callDate ? Date.parse(b.callDate) : 0;
    return (Number.isNaN(ta) ? 0 : ta) - (Number.isNaN(tb) ? 0 : tb);
  };
  const bySev = (a: MissedOpportunityFindingRow, b: MissedOpportunityFindingRow) =>
    (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9);

  const customers: CustomerBucket[] = [...byCustomer.entries()].map(([name, rows]) => {
    const ixOrder: string[] = [];
    const byIx = new Map<string, MissedOpportunityFindingRow[]>();
    for (const f of [...rows].sort(byTime)) {
      const k = interactionKey(f);
      if (!byIx.has(k)) {
        byIx.set(k, []);
        ixOrder.push(k);
      }
      byIx.get(k)!.push(f);
    }
    return {
      name,
      findings: [...rows].sort(bySev),
      interactions: ixOrder.map((key) => ({
        key,
        findings: [...(byIx.get(key) ?? [])].sort(bySev),
      })),
    };
  });

  customers.sort((a, b) => {
    const high = b.findings.filter((f) => f.severity === 'high').length
      - a.findings.filter((f) => f.severity === 'high').length;
    if (high !== 0) return high;
    const misses = b.findings.length - a.findings.length;
    if (misses !== 0) return misses;
    return a.name.localeCompare(b.name);
  });
  return customers;
}

function uniqueCrm(findings: MissedOpportunityFindingRow[]): { kind: 'TASK' | 'TICKET'; id: number }[] {
  const seen = new Set<string>();
  const out: { kind: 'TASK' | 'TICKET'; id: number }[] = [];
  for (const f of findings) {
    if (!f.crmRefKind || f.crmRefId == null) continue;
    const key = `${f.crmRefKind}:${f.crmRefId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: f.crmRefKind, id: f.crmRefId });
  }
  return out;
}

function renderInteractionChrome(rows: MissedOpportunityFindingRow[]): string {
  const f = rows[0];
  const bits = [
    f.direction ? f.direction.charAt(0).toUpperCase() + f.direction.slice(1).toLowerCase() : 'Call',
    talkMins(f.talkSecs),
    f.callDate ? fmtDateTime(f.callDate) : null,
  ].filter(Boolean).map(esc);

  const links: string[] = [];
  if (f.conversationId) links.push(`Call ${esc(f.conversationId)}`);
  for (const crm of uniqueCrm(rows)) {
    const label = crm.kind === 'TASK' ? `Task ${crm.id}` : `Ticket ${crm.id}`;
    links.push(`<a href="${esc(crmUrl(crm.kind, crm.id))}">${esc(label)}</a>`);
  }

  return `<p style="margin:0 0 8pt 0;font-size:9.5pt;color:#666666">${bits.join(' &middot; ')}${links.length ? ` &nbsp;|&nbsp; ${links.join(' &nbsp;|&nbsp; ')}` : ''}</p>`;
}

function renderFinding(f: MissedOpportunityFindingRow): string {
  const category = f.category ?? f.ruleName ?? f.ruleKey;
  return `
    <div style="margin:0 0 12pt 0;padding:8pt 10pt;border:1pt solid #e2e8f0;background:#f5f7f8">
      <p style="margin:0 0 2pt 0;font-size:9pt">
        <b style="text-transform:uppercase;letter-spacing:0.04em">${esc(category)}</b>
        &nbsp; ${severityChip(f.severity)}
      </p>
      <p style="margin:0 0 6pt 0;font-size:11.5pt;font-weight:bold;color:#000000">${esc(f.title)}</p>
      <p style="margin:0 0 6pt 0;font-size:10.5pt;color:#000000">${escMultiline(f.whatHappened)}</p>
      ${f.evidenceQuote ? `<p style="margin:0 0 6pt 0;padding:6pt 10pt;border-left:3pt solid #00aeef;background:#ffffff;font-style:italic;font-size:10.5pt;color:#333333">${f.evidenceSpeaker ? `<b style="font-style:normal;text-transform:uppercase;font-size:9pt;color:#666666">${f.evidenceSpeaker === 'CUSTOMER' ? 'Customer' : 'Rep'}:</b> ` : ''}&ldquo;${escMultiline(f.evidenceQuote)}&rdquo;</p>` : ''}
      <p style="margin:0 0 4pt 0;font-size:10.5pt;color:#000000"><b>Recommended approach:</b> ${escMultiline(f.recommendedApproach)}</p>
      ${f.recoveryAction ? `<p style="margin:0 0 4pt 0;font-size:10.5pt;color:#000000"><b>Recover this account:</b> ${escMultiline(f.recoveryAction)}</p>` : ''}
      ${f.estValueNote ? `<p style="margin:0;font-size:10pt;color:#666666"><b>Value at stake:</b> ${escMultiline(f.estValueNote)}</p>` : ''}
    </div>`;
}

function renderCustomer(bucket: CustomerBucket): string {
  const callCount = bucket.interactions.length;
  const missCount = bucket.findings.length;
  const cats = [...new Set(bucket.findings.map((f) => f.category).filter(Boolean))];
  const catLine = cats.length
    ? `<p style="margin:0 0 6pt 0;font-size:9pt;color:#666666;text-transform:uppercase">${cats.map(esc).join(' &middot; ')}</p>`
    : '';
  const interactions = bucket.interactions.map((ix) => `
    <div style="margin:0 0 10pt 0">
      ${renderInteractionChrome(ix.findings)}
      ${ix.findings.map(renderFinding).join('')}
    </div>`).join('');

  return `
    <h3 style="font-size:12pt;color:#000000;margin:14pt 0 4pt 0">${esc(bucket.name)}
      <span style="font-size:10pt;font-weight:normal;color:#666666">
        &mdash; ${callCount} call${callCount === 1 ? '' : 's'} · ${missCount} miss${missCount === 1 ? '' : 'es'}
      </span>
    </h3>
    ${catLine}
    ${interactions}`;
}

function renderSummary(r: MissedOpportunityResult): string {
  const cell = (label: string, value: string | number) => `
    <td style="width:20%;border:1pt solid #e2e8f0;padding:8pt;vertical-align:top">
      <div style="font-size:18pt;font-weight:bold;color:#000000">${esc(value)}</div>
      <div style="font-size:9pt;color:#666666;text-transform:uppercase">${esc(label)}</div>
    </td>`;
  // Clean calls leads: the review is a coaching tool, and opening on the number
  // of calls that needed no coaching is what keeps it from reading as a defect list.
  const clean = r.totals.cleanCallRate == null
    ? '—'
    : `${r.totals.cleanCalls} (${r.totals.cleanCallRate}%)`;
  return `
    <table style="width:100%;border-collapse:collapse;margin:0 0 16pt 0">
      <tr>
        ${cell('Clean Calls', clean)}
        ${cell('Total Misses', r.totals.findings)}
        ${cell('High Severity', r.totals.high)}
        ${cell('Misses / Call', r.totals.findingsPerCall ?? '—')}
        ${cell('Agents Affected', r.totals.agentsAffected)}
      </tr>
    </table>`;
}

function renderByRule(r: MissedOpportunityResult): string {
  if (!r.byRule.length) return '';
  const rows = r.byRule.map((rule) => `
    <tr>
      <td style="border:1pt solid #e2e8f0;padding:5pt 8pt;font-size:10pt">${esc(rule.ruleName ?? rule.ruleKey)}</td>
      <td style="border:1pt solid #e2e8f0;padding:5pt 8pt;font-size:10pt;color:#666666">${esc(rule.category ?? '')}</td>
      <td style="border:1pt solid #e2e8f0;padding:5pt 8pt;font-size:10pt;text-align:right;font-weight:bold">${esc(rule.findings)}</td>
    </tr>`).join('');
  return `
    <h2 style="font-size:13pt;color:#000000;margin:18pt 0 6pt 0">By Rule</h2>
    <table style="width:100%;border-collapse:collapse;margin:0 0 8pt 0">
      <tr style="background:#f5f7f8">
        <th style="border:1pt solid #e2e8f0;padding:5pt 8pt;text-align:left;font-size:9pt;text-transform:uppercase;color:#666666">Rule</th>
        <th style="border:1pt solid #e2e8f0;padding:5pt 8pt;text-align:left;font-size:9pt;text-transform:uppercase;color:#666666">Category</th>
        <th style="border:1pt solid #e2e8f0;padding:5pt 8pt;text-align:right;font-size:9pt;text-transform:uppercase;color:#666666">Misses</th>
      </tr>
      ${rows}
    </table>`;
}

function renderAgents(r: MissedOpportunityResult): string {
  const byAgent = new Map<string, MissedOpportunityFindingRow[]>();
  for (const f of r.findings) {
    const key = f.agentName ?? 'Unattributed';
    (byAgent.get(key) ?? byAgent.set(key, []).get(key)!).push(f);
  }
  const order = r.agents.map((a) => a.agentName).filter((n) => byAgent.has(n));
  for (const name of byAgent.keys()) if (!order.includes(name)) order.push(name);

  return order.map((name) => {
    const rows = r.agents.find((a) => a.agentName === name);
    const customers = groupFindingsForExport(byAgent.get(name) ?? []);
    const counts = rows
      ? ` &mdash; ${rows.findings} miss(es): ${rows.high} high, ${rows.medium} medium, ${rows.low} low`
      : '';
    return `
      <h2 style="font-size:13pt;color:#000000;margin:18pt 0 8pt 0;border-bottom:2pt solid #00aeef;padding-bottom:3pt">
        ${esc(name)}<span style="font-size:10pt;font-weight:normal;color:#666666">${counts}</span>
      </h2>
      ${customers.map(renderCustomer).join('')}`;
  }).join('');
}

export function renderMissedOpportunitiesDoc(
  result: MissedOpportunityResult,
  day: string,
): string {
  const run = result.run;
  const runLine = run
    ? `${run.callsAnalyzed} call(s) analyzed &middot; ${result.totals.findings} miss(es) found`
    : 'This day has not been graded.';

  const body = run
    ? `${renderSummary(result)}${renderByRule(result)}
       <h2 style="font-size:13pt;color:#000000;margin:18pt 0 8pt 0">Missed Opportunities by Agent</h2>
       ${renderAgents(result) || '<p style="font-size:10.5pt;color:#666666">No missed opportunities were found on this day.</p>'}`
    : `<p style="font-size:11pt;color:#666666">There is no graded run for this day, so there is nothing to report. Re-grade the day from the Settings tab, then export again.</p>`;

  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8"/>
<title>Missed Opportunities ${esc(day)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->
</head>
<body style="font-family:Calibri,Arial,sans-serif;color:#000000">
  <h1 style="font-size:20pt;color:#00aeef;margin:0 0 2pt 0">Missed Opportunities</h1>
  <p style="font-size:12pt;color:#000000;margin:0 0 2pt 0">${esc(fmtDayLong(day))}</p>
  <p style="font-size:9.5pt;color:#666666;margin:0 0 14pt 0">${runLine} &middot; Generated ${esc(fmtDateTime(new Date().toISOString()))}</p>
  ${body}
</body>
</html>`;
}
