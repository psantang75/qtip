import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer'
import type { WriteUpDetail, PriorDisciplineRow } from '@/services/writeupService'
import {
  WRITE_UP_TYPE_LABELS as TYPE_LABELS,
  WRITE_UP_STATUS_LABELS as STATUS_LABELS,
  COACHING_STATUS_LABELS as COACHING_STATUS,
  COACHING_PURPOSE_LABELS as PURPOSE_LABELS,
} from '@/constants/labels'
import { formatQualityDateLong as fmtDate, formatQualityDateTime as fmtDateTime } from '@/utils/dateFormat'
import { htmlToPdfNodes } from './htmlToPdf'

const BLUE = '#00aeef'
const DARK = '#1e293b'
const MID = '#475569'
const LIGHT = '#94a3b8'
const GRAY_BG = '#f1f5f9'
const BORDER = '#e2e8f0'
const SECTION_BG = '#e2e8f0'


function splitSep(val: string | string[] | null | undefined): string[] {
  if (Array.isArray(val)) return val.filter(Boolean)
  if (!val) return []
  return String(val).split('~|~').filter(Boolean)
}

const s = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 50, paddingHorizontal: 44, fontFamily: 'Helvetica', fontSize: 9, color: DARK },
  // Header
  hdr: { backgroundColor: GRAY_BG, marginHorizontal: -44, marginTop: -40, paddingHorizontal: 44, paddingTop: 18, paddingBottom: 12, borderBottomWidth: 3, borderBottomColor: BLUE, marginBottom: 16 },
  hdrBrand: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  hdrMark: { width: 4, height: 16, backgroundColor: BLUE, borderRadius: 1 },
  hdrBrandText: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: '#334155', letterSpacing: 0.4 },
  hdrBrandSub: { fontSize: 7.5, fontFamily: 'Helvetica', color: LIGHT, letterSpacing: 0.8 },
  hdrTitle: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: DARK, marginBottom: 1 },
  hdrSubtitle: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: MID, letterSpacing: 0.5 },
  hdrFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, paddingTop: 6, borderTopWidth: 0.5, borderTopColor: BORDER },
  hdrFooterText: { fontSize: 6.5, color: LIGHT },
  // Sections
  section: { marginBottom: 12 },
  sectionBar: { backgroundColor: SECTION_BG, paddingVertical: 4, paddingHorizontal: 10, marginBottom: 8, marginHorizontal: -10 },
  sectionBarText: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: '#334155', letterSpacing: 0.8 },
  // Field grids
  fieldRow: { flexDirection: 'row', marginBottom: 6 },
  fieldCol2: { width: '50%' },
  fieldCol3: { width: '33.33%' },
  fieldLabel: { fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: LIGHT, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 1 },
  fieldValue: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: DARK },
  // Body text
  body: { fontSize: 9, color: '#334155', lineHeight: 1.5, marginBottom: 6 },
  bodySm: { fontSize: 8, color: MID, lineHeight: 1.4, marginBottom: 4 },
  empty: { fontSize: 8, color: LIGHT, fontStyle: 'italic' },
  // Incident
  incidentTitle: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#334155', marginBottom: 4 },
  incidentDesc: { fontFamily: 'Helvetica', color: MID },
  violation: { marginBottom: 6, paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: BORDER },
  // Tables
  tblHeader: { flexDirection: 'row', backgroundColor: GRAY_BG, borderBottomWidth: 0.5, borderBottomColor: BORDER },
  tblHeaderCell: { fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: MID, letterSpacing: 0.6, textTransform: 'uppercase', paddingVertical: 4, paddingHorizontal: 6 },
  tblRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: BORDER },
  tblCell: { fontSize: 8, color: '#334155', paddingVertical: 4, paddingHorizontal: 6 },
  // Prior discipline
  priorRow: { paddingBottom: 6, marginBottom: 6, borderBottomWidth: 0.5, borderBottomColor: GRAY_BG },
  // Signature
  ackText: { fontSize: 8, color: MID, lineHeight: 1.5, fontStyle: 'italic', marginBottom: 14 },
  sigGrid: { flexDirection: 'row', gap: 24 },
  sigCol: { flex: 1 },
  sigHeading: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: MID, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6 },
  sigBox: { height: 32, justifyContent: 'flex-end', borderBottomWidth: 1, borderBottomColor: '#334155', marginBottom: 4 },
  sigMeta: { flexDirection: 'row', justifyContent: 'space-between', fontSize: 7.5, color: MID },
  sigStamp: { fontSize: 6.5, color: MID, marginTop: 3, fontStyle: 'italic' },
  sigImg: { width: 120, height: 28 },
  sigText: { fontSize: 12, fontFamily: 'Helvetica-Oblique', color: '#1e293b' },
  // Page footer (fixed)
  pageFooter: { position: 'absolute', bottom: 20, left: 44, right: 44, flexDirection: 'row', justifyContent: 'space-between', fontSize: 6.5, color: LIGHT, borderTopWidth: 0.5, borderTopColor: BORDER, paddingTop: 4 },
})

// ─── Sub-components ──────────────────────────────────────────────────────────

function SectionBar({ num, title }: { num: number; title: string }) {
  return (
    <View style={s.sectionBar}>
      <Text style={s.sectionBarText}>SECTION {num} — {title}</Text>
    </View>
  )
}

function Field({ label, value, width }: { label: string; value: string; width: '50%' | '33.33%' }) {
  return (
    <View style={{ width }}>
      <Text style={s.fieldLabel}>{label}</Text>
      <Text style={s.fieldValue}>{value}</Text>
    </View>
  )
}

function PageHeader({ typeLabel }: { typeLabel: string }) {
  return (
    <View style={s.hdr} fixed>
      <View style={s.hdrBrand}>
        <View style={s.hdrMark} />
        <Text style={s.hdrBrandText}>QTIP  <Text style={s.hdrBrandSub}>QUALITY TRAINING</Text></Text>
      </View>
      <Text style={s.hdrTitle}>EMPLOYEE CORRECTIVE ACTION FORM</Text>
      <Text style={s.hdrSubtitle}>{typeLabel.toUpperCase()} — CONFIDENTIAL</Text>
      <View style={s.hdrFooter}>
        <Text style={s.hdrFooterText}>QTIP | Human Resources | Confidential</Text>
        <Text style={s.hdrFooterText} render={({ pageNumber }) => `Page ${pageNumber}`} />
      </View>
    </View>
  )
}

function PageFooter({ preparedBy, date }: { preparedBy: string; date: string }) {
  return (
    <View style={s.pageFooter} fixed>
      <Text>Prepared by: {preparedBy} • Date: {date} • QTIP Document System</Text>
      <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  )
}

// ─── Main Document ───────────────────────────────────────────────────────────

export function WriteUpPdfDocument({ writeup }: { writeup: WriteUpDetail }) {
  const typeLabel = TYPE_LABELS[writeup.document_type] ?? writeup.document_type
  const meetingDate = fmtDate(writeup.meeting_date ?? writeup.created_at)
  const managerName = writeup.manager_name ?? writeup.created_by_name

  let sectionNum = 0
  const nextSection = () => ++sectionNum

  return (
    <Document title={`Write-Up #${writeup.id} — ${writeup.csr_name}`} author="QTIP">
      <Page size="LETTER" style={s.page} wrap>
        <PageHeader typeLabel={typeLabel} />
        <PageFooter preparedBy={writeup.created_by_name} date={meetingDate} />

        {/* Section 1: Employee Identification */}
        <View style={s.section} wrap={false}>
          <SectionBar num={nextSection()} title="EMPLOYEE IDENTIFICATION" />
          <View style={s.fieldRow}>
            <Field label="Employee Name" value={writeup.csr_name} width="50%" />
            <Field label="Employee ID" value={`EMP-${String(writeup.csr_id).padStart(4, '0')}`} width="50%" />
          </View>
          <View style={s.fieldRow}>
            <Field label="Meeting Date" value={meetingDate} width="50%" />
            <Field label="Document Type" value={typeLabel} width="50%" />
          </View>
          <View style={s.fieldRow}>
            <Field label="Manager" value={managerName} width="50%" />
            <Field label="HR Witness" value={writeup.hr_witness_name ?? '—'} width="50%" />
          </View>
        </View>

        {/* Section 2: Incidents & Policy Violations */}
        <View style={s.section}>
          <SectionBar num={nextSection()} title="INCIDENT & POLICY VIOLATIONS" />
          {writeup.incidents?.length ? writeup.incidents.map((inc, i) => (
            <View key={inc.id} style={{ marginBottom: 10 }} wrap={false}>
              <Text style={s.incidentTitle}>Incident {i + 1}</Text>
              {htmlToPdfNodes(inc.description)}
              {inc.violations?.map(v => (
                <View key={v.id} style={s.violation}>
                  <View style={s.fieldRow}>
                    <Field label="Policy Violated" value={v.policy_violated} width="50%" />
                    <Field label="Reference" value={v.reference_material ?? '—'} width="50%" />
                  </View>
                  {v.examples?.length > 0 && (
                    <View style={{ marginTop: 4 }}>
                      <View style={s.tblHeader}>
                        <Text style={[s.tblHeaderCell, { width: '18%' }]}>DATE</Text>
                        <Text style={[s.tblHeaderCell, { width: '68%' }]}>EXAMPLE DESCRIPTION</Text>
                        <Text style={[s.tblHeaderCell, { width: '14%' }]}>SOURCE</Text>
                      </View>
                      {v.examples.map((ex, ei) => (
                        <View key={ex.id ?? ei} style={s.tblRow}>
                          <Text style={[s.tblCell, { width: '18%' }]}>{fmtDate(ex.example_date)}</Text>
                          <View style={[s.tblCell, { width: '68%' }]}>{htmlToPdfNodes(ex.description, { fontSize: 8 })}</View>
                          <Text style={[s.tblCell, { width: '14%' }]}>
                            {ex.source === 'QA_IMPORT' ? 'QA Import' : ex.source === 'COACHING_IMPORT' ? 'Coaching' : 'Manual'}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              ))}
            </View>
          )) : (
            <Text style={s.empty}>No incidents recorded.</Text>
          )}
        </View>

        {/* Section 3: Corrective Action */}
        <View style={s.section}>
          <SectionBar num={nextSection()} title="CORRECTIVE ACTION & EXPECTATIONS" />
          {htmlToPdfNodes(writeup.corrective_action) ?? <Text style={s.empty}>Not specified.</Text>}
          <View style={s.fieldRow}>
            <Field label="Timeline for Correction" value={writeup.correction_timeline ?? '—'} width="33.33%" />
            <Field label="Consequence if Not Met" value={writeup.consequence ?? '—'} width="33.33%" />
            <Field label="Follow-Up Date" value={fmtDate(writeup.checkin_date)} width="33.33%" />
          </View>
          {writeup.linked_coaching_session && (
            <View style={{ marginTop: 6, paddingTop: 6, borderTopWidth: 0.5, borderTopColor: BORDER }}>
              <Text style={s.fieldLabel}>Linked Coaching Session</Text>
              <Text style={s.bodySm}>
                {PURPOSE_LABELS[writeup.linked_coaching_session.coaching_purpose ?? ''] ?? writeup.linked_coaching_session.coaching_purpose}
                {' — '}
                {COACHING_STATUS[writeup.linked_coaching_session.status ?? ''] ?? writeup.linked_coaching_session.status}
                {writeup.linked_coaching_session.date && ` (${fmtDate(String(writeup.linked_coaching_session.date).slice(0, 10))})`}
              </Text>
            </View>
          )}
        </View>

        {/* Section 4: Prior Discipline (optional) */}
        {writeup.prior_discipline?.length > 0 && (
          <View style={s.section}>
            <SectionBar num={nextSection()} title="PRIOR DISCIPLINE HISTORY" />
            {writeup.prior_discipline.map((pd: PriorDisciplineRow, i: number) => {
              const isWU = pd.reference_type === 'write_up'
              const label = isWU ? (TYPE_LABELS[pd.document_type] ?? pd.document_type) : (PURPOSE_LABELS[pd.coaching_purpose ?? ''] ?? pd.coaching_purpose)
              const statusLabel = isWU ? (STATUS_LABELS[pd.status] ?? pd.status) : (COACHING_STATUS[pd.status ?? ''] ?? pd.status)
              const detail = isWU ? splitSep(pd.policies_violated) : splitSep(pd.topic_names)
              const desc = isWU ? splitSep(pd.incident_descriptions).join(' | ') : pd.notes
              return (
                <View key={i} style={s.priorRow}>
                  <View style={s.fieldRow}>
                    <Field label="Type" value={`${isWU ? 'Write-Up' : 'Coaching'} — ${label}`} width="33.33%" />
                    <Field label="Status" value={statusLabel ?? '—'} width="33.33%" />
                    <Field label="Date" value={fmtDate(pd.date)} width="33.33%" />
                  </View>
                  {detail.length > 0 && <Text style={s.bodySm}>{detail.join(', ')}</Text>}
                  {desc && <Text style={s.bodySm}>{desc}</Text>}
                </View>
              )
            })}
          </View>
        )}

        {/* Section 5: Meeting Notes (optional) */}
        {writeup.meeting_notes && (
          <View style={s.section} wrap={false}>
            <SectionBar num={nextSection()} title="MEETING NOTES" />
            {htmlToPdfNodes(writeup.meeting_notes)}
          </View>
        )}

        {/* Section N: Acknowledgment & Signatures */}
        <View style={s.section} wrap={false}>
          <SectionBar num={nextSection()} title="ACKNOWLEDGMENT & SIGNATURES" />
          <Text style={s.ackText}>
            By signing below, the employee acknowledges receipt of this Corrective Action Form.
          </Text>

          <View style={s.sigGrid}>
            <View style={s.sigCol}>
              <Text style={s.sigHeading}>EMPLOYEE SIGNATURE</Text>
              <View style={s.sigBox}>
                {writeup.signature_data && (
                  <Image src={writeup.signature_data} style={s.sigImg} />
                )}
              </View>
              <View style={s.sigMeta}>
                <Text>Print Name: {writeup.csr_name}</Text>
                <Text>Date: {writeup.signed_at ? fmtDate(writeup.signed_at) : '___________'}</Text>
              </View>
              {writeup.signed_at && (
                <Text style={s.sigStamp}>
                  Signed: {fmtDateTime(writeup.signed_at)}{writeup.signed_ip ? ` | IP: ${writeup.signed_ip}` : ''}
                </Text>
              )}
            </View>
            <View style={s.sigCol}>
              <Text style={s.sigHeading}>MANAGER SIGNATURE</Text>
              <View style={s.sigBox}>
                <Text style={s.sigText}>{managerName}</Text>
              </View>
              <View style={s.sigMeta}>
                <Text>Print Name: {managerName}</Text>
                <Text>Date: {fmtDate(writeup.meeting_date ?? writeup.created_at)}</Text>
              </View>
            </View>
          </View>
        </View>

      </Page>
    </Document>
  )
}
