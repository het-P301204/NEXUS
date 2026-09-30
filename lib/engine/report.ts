import type {
  AuditEvent,
  Iso,
  Organization,
  ReportContent,
  ReportKind,
  ReportSection,
  User,
} from '../../types/domain.ts'
import { RULE_SET } from '../../rules/cra-article14.ts'
import { JUSTIFICATION_LABELS, STEPS } from './affectedness.ts'
import type { CaseAnalysis } from './analyze.ts'
import type { CaseBundle, ReportSummary } from './bundle.ts'
import { determinationEvidenceIds } from './bundle.ts'
import { NON_REPORT_REASON_LABELS } from './reportability.ts'
import { formatDuration } from './time.ts'

/**
 * Report generation.
 *
 * A report version is a frozen snapshot: plain-text sections built from the
 * case records at one instant, hashed, and never replaced. Regenerating
 * produces a new version. The content carries no HTML; every renderer
 * escapes it.
 */

export const DISCLAIMER =
  'NEXUS provides technical and operational decision support. It does not constitute legal advice or a legal determination of regulatory compliance.'

export const REPORT_KIND_LABELS: Record<ReportKind, string> = {
  EARLY_WARNING: 'Early Warning Notification',
  VULNERABILITY_NOTIFICATION: 'Vulnerability Notification',
  FINAL_REPORT: 'Final Report',
  DECISION_RECORD: 'Reportability Decision Record',
}

export function fmtUtc(at: Iso | null | undefined): string {
  if (!at) return '--'
  return at.replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC').replace(/Z$/, ' UTC')
}

export interface ReportInputs {
  kind: ReportKind
  bundle: CaseBundle
  analysis: CaseAnalysis
  org: Organization
  users: User[]
  auditRefs: AuditEvent[]
  now: Iso
}

export function buildReportContent(input: ReportInputs): ReportContent {
  const { kind, bundle, analysis, org, users, now } = input
  const name = (id: string | null | undefined) => users.find((u) => u.id === id)?.name ?? id ?? '--'
  const v = bundle.vulnerability
  const c = bundle.case
  const s = analysis.suggestion
  const decision = analysis.decision
  const sections: ReportSection[] = []

  const reportingState = decision
    ? decision.outcome === 'REPORT'
      ? 'Reportable -- recorded decision to report'
      : `Reporting not required -- ${NON_REPORT_REASON_LABELS[decision.nonReportReason ?? 'OTHER'].toLowerCase()}`
    : `No decision recorded -- rule evaluation: ${s.outcome === 'PENDING' ? 'pending' : s.outcome.replace(/_/g, ' ').toLowerCase()}`

  // Executive summary
  const summary: string[] = []
  summary.push(
    `${org.name} is handling ${v.cve ?? v.id} (${v.title}) under case ${c.id}. The case concerns ${bundle.products.map((p) => `${p.name} ${p.version}`).join(', ')}.`,
  )
  summary.push(`Current state: ${analysis.status.replace(/_/g, ' ').toLowerCase()}. ${reportingState}.`)
  if (analysis.clock.awarenessInstant) {
    summary.push(`Awareness of an actively exploited vulnerability was established at ${fmtUtc(analysis.clock.awarenessInstant)}.`)
  }
  const ew = analysis.deadlines.find((d) => d.kind === 'EARLY_WARNING')!
  if (ew.dueAt) summary.push(`Early warning deadline: ${fmtUtc(ew.dueAt)} (${ew.status.replace(/_/g, ' ').toLowerCase()}).`)
  sections.push({ id: 'executive-summary', title: 'Executive Summary', paragraphs: summary })

  sections.push({
    id: 'case-information',
    title: 'Case Information',
    paragraphs: [],
    facts: [
      ['Case', c.id],
      ['Title', c.title],
      ['Status', analysis.status.replace(/_/g, ' ')],
      ['Owner', name(c.ownerId)],
      ['Opened', fmtUtc(c.createdAt)],
      ['Organisation', org.legalEntity],
      ['Member States where made available', org.memberStatesMadeAvailable.join(', ')],
      ['Rule set', `${RULE_SET.id} ${RULE_SET.version}`],
    ],
  })

  sections.push({
    id: 'vulnerability',
    title: 'Vulnerability',
    paragraphs: [v.description],
    facts: [
      ['Identifier', v.cve ?? v.id],
      ['CWE', v.cwe ?? '--'],
      ['CVSS', v.cvssScore !== null ? `${v.cvssScore.toFixed(1)}${v.cvssVector ? ` (${v.cvssVector})` : ''}` : '--'],
      ['Severity', v.severity],
      ['Component', bundle.components.find((x) => x.id === v.componentId)?.name ?? '--'],
      ['Affected versions', v.affectedVersions],
      ['Fixed version', v.fixedVersion ?? '--'],
      ['Source', v.source],
      ['Vendor advisory', v.vendorAdvisory ?? '--'],
    ],
  })

  sections.push({
    id: 'affected-products',
    title: 'Affected Products',
    paragraphs: [],
    table: {
      columns: ['Product', 'Version', 'Component version', 'Made available in EU', 'Affectedness'],
      rows: bundle.products.map((p) => {
        const d = analysis.determinations[p.id]
        const pc = bundle.productComponents.find((x) => x.productId === p.id && x.componentId === v.componentId)
        return [
          p.name,
          p.version,
          pc ? `${pc.version} (${pc.relation})` : 'not in SBOM',
          p.madeAvailableInEu ? 'Yes' : 'No',
          d ? d.result.replace(/_/g, ' ') : 'NO DETERMINATION',
        ]
      }),
    },
  })

  const affParas: string[] = []
  for (const p of bundle.products) {
    const d = analysis.determinations[p.id]
    const e = analysis.evaluations[p.id]
    if (!d || !e) {
      affParas.push(`${p.name} ${p.version}: no determination recorded. Treated as under investigation.`)
      continue
    }
    const path = STEPS.map((st) => `${st.n}. ${st.question} ${d.answers[st.id].answer ?? 'not answered'}`).join(' ')
    affParas.push(
      `${p.name} ${p.version} -- ${d.result.replace(/_/g, ' ')}${d.vexJustification ? ` (${JUSTIFICATION_LABELS[d.vexJustification]})` : ''}. Determination ${d.id} by ${name(d.analystId)} at ${fmtUtc(d.recordedAt)}, confidence ${d.confidence}. ${d.rationale}`,
    )
    affParas.push(`Reasoning path: ${path}`)
    if (d.unresolved) affParas.push(`Unresolved: ${d.unresolved}`)
    if (e.actionStatement) affParas.push(`Action statement: ${e.actionStatement}`)
  }
  sections.push({ id: 'affectedness', title: 'Affectedness Determination', paragraphs: affParas })

  sections.push({
    id: 'exploitation',
    title: 'Exploitation Assessment',
    paragraphs: [
      `Exploitation status: ${v.exploitation.replace(/_/g, ' ')}. ${s.exploitationEstablished ? 'Reliable evidence of exploitation by a malicious actor is on the record (Art. 3(42)).' : 'The reliable-evidence bar of Art. 3(42) is not met on the current record.'}`,
      ...bundle.threatIntel.map(
        (t) =>
          `${t.id}: ${t.source} -- ${t.observedExploitation ? 'exploitation observed' : 'no exploitation observed'}${t.firstObserved ? `, first observed ${fmtUtc(t.firstObserved)}` : ''}, confidence ${t.confidence}. Indicator: ${t.indicator}. Reference: ${t.reference}.`,
      ),
    ],
  })

  const va = analysis.clock.vulnerabilityAwareness
  const ea = analysis.clock.exploitationAwareness
  const criterion = (id: string | null) => bundle.criteria.find((x) => x.id === id)
  sections.push({
    id: 'awareness',
    title: 'Awareness Criterion',
    paragraphs: [
      va
        ? `Vulnerability awareness ${va.original.id}: ${fmtUtc(va.occurredAt)} -- criterion "${criterion(va.current.criterionId)?.label ?? 'unspecified'}", responsible role ${va.current.responsibleRole ?? '--'}, source ${va.current.source}.`
        : 'Vulnerability awareness: not recorded.',
      ea
        ? `Exploitation awareness ${ea.original.id}: ${fmtUtc(ea.occurredAt)} -- criterion "${criterion(ea.current.criterionId)?.label ?? 'unspecified'}", responsible role ${ea.current.responsibleRole ?? '--'}, source ${ea.current.source}.`
        : 'Exploitation awareness: not established.',
      ...analysis.transitional.reasoning,
    ],
  })

  sections.push({
    id: 'clock',
    title: 'Clock of Record',
    paragraphs: analysis.clock.corrections.length
      ? [`${analysis.clock.corrections.length} correction event(s) are on the record. Original timestamps are preserved.`]
      : [],
    table: {
      columns: ['Stage', 'Event', 'Timestamp', 'Elapsed', 'Source', 'Integrity hash'],
      rows: analysis.clock.stages.map((st) => [
        `${String(st.index).padStart(2, '0')} ${st.label}`,
        st.event ? `${st.event.original.id}${st.event.corrections.length ? ` (corrected by ${st.event.current.id})` : ''}` : '--',
        st.at ? fmtUtc(st.at) : st.state.replace(/_/g, ' '),
        st.sincePreviousMs !== null ? formatDuration(st.sincePreviousMs) : '--',
        st.event?.current.source ?? '--',
        st.event ? st.event.current.integrityHash.slice(0, 16) : '--',
      ]),
    },
  })

  const determinationParas: string[] = [
    `Rule evaluation (${RULE_SET.version}): ${s.headline}.`,
    ...analysis.ruleTrace.steps.map((st) => `${st.label}: ${st.result}.`),
  ]
  if (decision) {
    determinationParas.push(
      `Recorded decision ${decision.id}: ${decision.outcome === 'REPORT' ? 'REPORT' : 'REPORTING NOT REQUIRED'}${decision.nonReportReason ? ` -- ${NON_REPORT_REASON_LABELS[decision.nonReportReason]}` : ''}. Recorded by ${name(decision.analystId)} at ${fmtUtc(decision.decidedAt)}.`,
    )
    if (decision.divergenceReason) determinationParas.push(`Divergence from rule evaluation: ${decision.divergenceReason}`)
  } else {
    determinationParas.push('No reportability decision has been recorded.')
  }
  sections.push({ id: 'reporting-determination', title: 'Reporting Determination', paragraphs: determinationParas })

  sections.push({
    id: 'deadlines',
    title: 'Deadline Status',
    paragraphs: [],
    table: {
      columns: ['Deadline', 'Rule', 'Start', 'Due', 'Status'],
      rows: analysis.deadlines.map((d) => [
        d.label,
        `${d.ruleId} (${d.citation})`,
        d.start ? `${d.start.label} ${fmtUtc(d.start.at)}` : '--',
        d.dueAt ? fmtUtc(d.dueAt) : '--',
        d.status.replace(/_/g, ' ') + (d.completedAt ? ` at ${fmtUtc(d.completedAt)}` : ''),
      ]),
    },
  })

  sections.push({
    id: 'evidence',
    title: 'Evidence Register',
    paragraphs: [
      `Evidence completeness: ${analysis.completeness.satisfied} of ${analysis.completeness.applicable} applicable items satisfied.`,
    ],
    table: {
      columns: ['Evidence', 'Type', 'Title', 'Source', 'SHA-256'],
      // Report content is frozen and hashed, and every reader of the report sees the
      // same bytes, so it cannot be redacted per viewer later. Restricted items are
      // written by id, type and hash only; the register shows the rest to roles
      // allowed to read it.
      rows: bundle.evidence.map((e) => [
        e.id,
        e.type.replace(/_/g, ' '),
        e.classification === 'restricted' ? 'Restricted item (title withheld)' : e.title,
        e.classification === 'restricted' ? 'Withheld' : e.source,
        e.sha256,
      ]),
    },
  })

  const rationale: string[] = []
  if (decision) {
    rationale.push(decision.rationale)
    rationale.push(`Confidence: ${decision.confidence}.${decision.unresolved ? ` Unresolved: ${decision.unresolved}` : ''}`)
    if (decision.evidenceIds.length) rationale.push(`Supporting evidence: ${decision.evidenceIds.join(', ')}.`)
  }
  for (const p of bundle.products) {
    const d = analysis.determinations[p.id]
    if (d) rationale.push(`${p.name}: ${d.rationale} (evidence ${determinationEvidenceIds(bundle, d).join(', ') || 'none'})`)
  }
  sections.push({ id: 'rationale', title: 'Decision Rationale', paragraphs: rationale.length ? rationale : ['No rationale recorded.'] })

  sections.push({
    id: 'audit',
    title: 'Audit References',
    paragraphs: [
      `${input.auditRefs.length} ledger entries reference this case. Each hash is chained to the previous entry; any alteration is detectable by ledger verification.`,
    ],
    table: {
      columns: ['Entry', 'Time', 'Event', 'Hash'],
      rows: input.auditRefs.slice(-12).map((a) => [a.id, fmtUtc(a.at), a.eventType, a.hash.slice(0, 24)]),
    },
  })

  return {
    heading: REPORT_KIND_LABELS[kind],
    subheading: `${v.cve ?? v.id} -- ${bundle.products.map((p) => p.name).join(', ')}`,
    organization: org.name,
    caseId: c.id,
    generatedAt: now,
    ruleSetVersion: RULE_SET.version,
    disclaimer: DISCLAIMER,
    sections,
  }
}

/**
 * Version numbering. A new major version when the decision or the case
 * status differs from the latest version of the same kind; otherwise a
 * minor version. The first version of a kind is 1.0.
 */
export function nextVersion(
  existing: ReportSummary[],
  kind: ReportKind,
  analysis: CaseAnalysis,
  decisionIdAtLatest: (r: ReportSummary) => string | null,
): { major: number; minor: number } {
  const same = existing.filter((r) => r.kind === kind).sort((a, b) => a.major - b.major || a.minor - b.minor)
  const latest = same.at(-1)
  if (!latest) return { major: 1, minor: 0 }
  const decisionChanged = decisionIdAtLatest(latest) !== (analysis.decision?.id ?? null)
  if (decisionChanged || latest.caseStatus !== analysis.status) return { major: latest.major + 1, minor: 0 }
  return { major: latest.major, minor: latest.minor + 1 }
}
