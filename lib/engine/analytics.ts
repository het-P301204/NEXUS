import type { CaseStatus, EscalationRule, Iso, SubmissionStage } from '../../types/domain.ts'
import type { CaseAnalysis } from './analyze.ts'
import type { CaseBundle, ReportSummary } from './bundle.ts'
import type { Deadline } from './deadlines.ts'
import { isRunning } from './deadlines.ts'
import { diffMs, ms } from './time.ts'

/**
 * Operational analytics.
 *
 * Every figure answers a question an operator would ask, says how it is
 * measured, and carries its sample size. There is no composite score. An
 * average over three cases is labelled as an average over three cases.
 */

export type Range = '7d' | '30d' | '90d' | 'all'

export const RANGE_MS: Record<Range, number | null> = {
  '7d': 7 * 86400000,
  '30d': 30 * 86400000,
  '90d': 90 * 86400000,
  all: null,
}

export interface Measure {
  valueMs: number | null
  n: number
  definition: string
}

export interface Analytics {
  range: Range
  cases: number
  openClocks: number
  overdueClocks: number
  determinationTime: Measure
  awarenessToDecision: Measure
  detectionToAwareness: Measure
  byStatus: Array<{ status: CaseStatus; count: number }>
  byAffectedness: Array<{ result: string; count: number }>
  evidenceGaps: { total: number; byItem: Array<{ label: string; count: number }> }
  turnaround: Array<{ caseId: string; title: string; awarenessToDecisionMs: number; decidedAt: Iso }>
  submissions: Array<{ stage: SubmissionStage; count: number }>
  deadlineDistribution: Array<{ bucket: string; count: number; critical: number }>
  deadlineOutcomes: { onTime: number; late: number; overdue: number }
}

const STATUSES: CaseStatus[] = [
  'NEW',
  'INVESTIGATING',
  'AWARENESS_ESTABLISHED',
  'DETERMINATION_PENDING',
  'REPORTABLE',
  'NOT_REPORTABLE',
  'SUBMITTED',
  'CLOSED',
]

const STAGES: SubmissionStage[] = ['DRAFT', 'INTERNAL_REVIEW', 'APPROVED', 'READY', 'SUBMITTED', 'ACKNOWLEDGED', 'CLOSED']

function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

export function computeAnalytics(
  items: Array<{ bundle: CaseBundle; analysis: CaseAnalysis }>,
  reports: ReportSummary[],
  range: Range,
  now: Iso,
): Analytics {
  const window = RANGE_MS[range]
  const since = window === null ? null : ms(now) - window
  const inRange = items.filter(({ bundle }) => since === null || ms(bundle.case.createdAt) >= since)

  const determinationTimes: number[] = []
  const awarenessToDecision: number[] = []
  const detectionToAwareness: number[] = []
  const turnaround: Analytics['turnaround'] = []

  for (const { bundle, analysis } of inRange) {
    const detection = analysis.clock.byType.DETECTION?.[0]?.occurredAt ?? null
    const firstAware = analysis.clock.vulnerabilityAwareness?.occurredAt ?? analysis.clock.exploitationAwareness?.occurredAt ?? null
    const finalDets = bundle.determinations
      .filter((d) => d.result !== 'UNDER_INVESTIGATION')
      .sort((a, b) => ms(a.recordedAt) - ms(b.recordedAt))
    if (detection && finalDets[0]) determinationTimes.push(diffMs(finalDets[0].recordedAt, detection))
    if (detection && firstAware) detectionToAwareness.push(diffMs(firstAware, detection))
    const firstDecision = [...bundle.decisions].sort((a, b) => ms(a.decidedAt) - ms(b.decidedAt))[0]
    if (firstAware && firstDecision) {
      const d = diffMs(firstDecision.decidedAt, firstAware)
      awarenessToDecision.push(d)
      turnaround.push({ caseId: bundle.case.id, title: bundle.case.title, awarenessToDecisionMs: d, decidedAt: firstDecision.decidedAt })
    }
  }

  const open = items.filter(({ bundle }) => bundle.case.lifecycle === 'open')
  const running: Deadline[] = open.flatMap(({ analysis }) => analysis.deadlines.filter(isRunning))

  const gapCounts = new Map<string, number>()
  for (const { analysis } of open) for (const m of analysis.completeness.missing) gapCounts.set(m.label, (gapCounts.get(m.label) ?? 0) + 1)

  const affCounts = new Map<string, number>()
  for (const { analysis } of inRange) {
    const k = analysis.suggestion.aggregateAffectedness
    affCounts.set(k, (affCounts.get(k) ?? 0) + 1)
  }

  const buckets: Array<{ bucket: string; max: number }> = [
    { bucket: 'Overdue', max: 0 },
    { bucket: '< 6h', max: 6 * 3600000 },
    { bucket: '6-24h', max: 24 * 3600000 },
    { bucket: '1-3d', max: 3 * 86400000 },
    { bucket: '3-14d', max: 14 * 86400000 },
    { bucket: '> 14d', max: Number.POSITIVE_INFINITY },
  ]
  const distribution = buckets.map((b) => ({ bucket: b.bucket, count: 0, critical: 0 }))
  for (const d of running) {
    const r = d.remainingMs ?? 0
    const i = r < 0 ? 0 : buckets.findIndex((b, idx) => idx > 0 && r <= b.max)
    const slot = distribution[i === -1 ? buckets.length - 1 : i]!
    slot.count++
    if (d.status === 'CRITICAL' || d.status === 'OVERDUE') slot.critical++
  }

  let onTime = 0
  let late = 0
  for (const { analysis } of inRange) {
    for (const d of analysis.deadlines) {
      if (d.status === 'COMPLETED') onTime++
      if (d.status === 'COMPLETED_LATE') late++
    }
  }

  const reportsInRange = reports.filter((r) => since === null || ms(r.generatedAt) >= since)

  return {
    range,
    cases: inRange.length,
    openClocks: running.length,
    overdueClocks: running.filter((d) => d.status === 'OVERDUE').length,
    determinationTime: {
      valueMs: mean(determinationTimes),
      n: determinationTimes.length,
      definition: 'From the first detection signal to the first determination that is not UNDER INVESTIGATION.',
    },
    awarenessToDecision: {
      valueMs: mean(awarenessToDecision),
      n: awarenessToDecision.length,
      definition: 'From the first awareness event to the first recorded reportability decision.',
    },
    detectionToAwareness: {
      valueMs: mean(detectionToAwareness),
      n: detectionToAwareness.length,
      definition: 'From the first detection signal to the first awareness event.',
    },
    byStatus: STATUSES.map((status) => ({ status, count: inRange.filter(({ analysis }) => analysis.status === status).length })),
    byAffectedness: ['AFFECTED', 'UNDER_INVESTIGATION', 'NOT_AFFECTED'].map((result) => ({ result, count: affCounts.get(result) ?? 0 })),
    evidenceGaps: {
      total: [...gapCounts.values()].reduce((a, b) => a + b, 0),
      byItem: [...gapCounts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    },
    turnaround: turnaround.sort((a, b) => ms(a.decidedAt) - ms(b.decidedAt)),
    submissions: STAGES.map((stage) => ({ stage, count: reportsInRange.filter((r) => r.stage === stage).length })),
    deadlineDistribution: distribution,
    deadlineOutcomes: { onTime, late, overdue: running.filter((d) => d.status === 'OVERDUE').length },
  }
}

// ---------------------------------------------------------------------------
// Escalation (demo behaviour)
// ---------------------------------------------------------------------------

export interface EscalationNotice {
  ruleId: string
  label: string
  level: EscalationRule['level']
  targetRole: EscalationRule['targetRole']
  firesAt: Iso
  fired: boolean
}

/** Which escalation steps have fired for a deadline, and which is next. */
export function escalationFor(deadline: Deadline, rules: EscalationRule[], now: Iso): EscalationNotice[] {
  if (!isRunning(deadline) || !deadline.dueAt) return []
  const due = ms(deadline.dueAt)
  return rules
    .filter((r) => r.active)
    .sort((a, b) => b.offsetMinutes - a.offsetMinutes)
    .map((r) => {
      const firesAt = due - r.offsetMinutes * 60000
      return {
        ruleId: r.id,
        label: r.label,
        level: r.level,
        targetRole: r.targetRole,
        firesAt: new Date(firesAt).toISOString(),
        fired: ms(now) >= firesAt,
      }
    })
}
