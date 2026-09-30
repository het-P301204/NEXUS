import type {
  CaseStatus,
  Decision,
  Determination,
  Iso,
  RuleTrace,
  RuleTraceStep,
} from '../../types/domain.ts'
import { RULE_SET } from '../../rules/cra-article14.ts'
import type { AffectednessEvaluation } from './affectedness.ts'
import { evaluateAffectedness } from './affectedness.ts'
import type { CaseBundle } from './bundle.ts'
import {
  currentDecision,
  currentDeterminations,
  determinationEvidenceIds,
  eventEvidenceIds,
  exploitationEvidence,
} from './bundle.ts'
import type { ClockOfRecord } from './clock.ts'
import { buildClock } from './clock.ts'
import type { Completeness, GapReport } from './completeness.ts'
import { computeCompleteness, detectGaps } from './completeness.ts'
import type { Deadline, DecisionStanding } from './deadlines.ts'
import { computeDeadlines, decisionStanding, nextDeadline } from './deadlines.ts'
import type { QualityFinding } from './quality.ts'
import { checkQuality } from './quality.ts'
import type { ReportabilitySuggestion } from './reportability.ts'
import { evaluateReportability } from './reportability.ts'
import type { TransitionalEvaluation } from './transitional.ts'
import { evaluateTransitional } from './transitional.ts'

/**
 * analyzeCase: records in, every derived view out.
 *
 * Pure. Given the same bundle, rule set and instant it returns the same
 * analysis, on the server, in the browser and in the what-if simulator.
 */

export type HealthState = 'READY' | 'INCOMPLETE' | 'BLOCKED' | 'UNDER_REVIEW'

export interface CaseHealth {
  state: HealthState
  reason: string
}

export type ExplanationState = 'established' | 'not_established' | 'not_applicable' | 'pending'

export interface ExplanationStep {
  n: number
  title: string
  statement: string
  state: ExplanationState
  evidenceIds: string[]
  refs: string[]
  tab: string
}

export interface CaseAnalysis {
  now: Iso
  status: CaseStatus
  clock: ClockOfRecord
  transitional: TransitionalEvaluation
  deadlines: Deadline[]
  nextDeadline: Deadline | null
  determinations: Record<string, Determination>
  evaluations: Record<string, AffectednessEvaluation>
  decision: Decision | null
  /** Whether the current decision is in force (a decision not to report needs approval, and current awareness). */
  decisionStanding: DecisionStanding | null
  suggestion: ReportabilitySuggestion
  ruleTrace: RuleTrace
  completeness: Completeness
  gaps: GapReport
  quality: QualityFinding[]
  health: CaseHealth
  explanation: ExplanationStep[]
  pendingReviews: Array<{ reportId: string; kind: string; stage: string }>
}

export function deriveStatus(bundle: CaseBundle, clock: ClockOfRecord, decision: Decision | null, standing: DecisionStanding | null = null): CaseStatus {
  if (bundle.case.lifecycle !== 'open') return 'CLOSED'
  if (clock.earlyWarningSubmitted) return 'SUBMITTED'
  // A decision overtaken by later awareness no longer answers the question.
  if (decision && !standing?.staleBy) return decision.outcome === 'REPORT' ? 'REPORTABLE' : 'NOT_REPORTABLE'
  const aware = clock.vulnerabilityAwareness || clock.exploitationAwareness
  if (aware) return bundle.determinations.length > 0 ? 'DETERMINATION_PENDING' : 'AWARENESS_ESTABLISHED'
  if (clock.byType.DETECTION?.length || bundle.determinations.length > 0) return 'INVESTIGATING'
  return 'NEW'
}

function deadlineTrace(deadlines: Deadline[]): RuleTraceStep[] {
  return deadlines.map((d) => ({
    ruleId: d.ruleId,
    label: `${d.label} deadline`,
    inputs: {
      'Start event': d.start ? `${d.start.label} (${d.start.eventId})` : null,
      'Start timestamp': d.start?.at ?? null,
      Duration: d.durationLabel,
    },
    result: d.dueAt ? `Due ${d.dueAt}` : d.status.replace(/_/g, ' '),
    detail: d.reason,
    state:
      d.status === 'COMPLETED' || d.status === 'ON_TRACK' || d.status === 'WATCH'
        ? 'pass'
        : d.status === 'OVERDUE' || d.status === 'COMPLETED_LATE' || d.status === 'CRITICAL'
          ? 'fail'
          : d.status === 'NOT_APPLICABLE'
            ? 'info'
            : 'pending',
  }))
}

export function analyzeCase(bundle: CaseBundle, now: Iso): CaseAnalysis {
  const decision = currentDecision(bundle)
  const clock = buildClock(bundle.events, { decisionOutcome: decision?.outcome ?? null })
  const standing = decision ? decisionStanding(decision, clock, bundle.reports.filter((r) => r.kind === 'DECISION_RECORD')) : null
  const transitional = evaluateTransitional(
    clock.vulnerabilityAwareness?.occurredAt ?? null,
    clock.exploitationAwareness?.occurredAt ?? null,
    RULE_SET.applicationInstant,
  )
  const dets = currentDeterminations(bundle)
  const evaluations = new Map<string, AffectednessEvaluation>()
  for (const [pid, d] of dets) evaluations.set(pid, evaluateAffectedness(d.answers))

  const deadlines = computeDeadlines({
    clock,
    transitional,
    decision: decision && standing ? { id: decision.id, outcome: decision.outcome, standing } : null,
    now,
  })

  const suggestion = evaluateReportability({
    vulnerability: bundle.vulnerability,
    products: bundle.products,
    determinations: dets,
    clock,
    transitional,
    exploitationEvidenceCount: exploitationEvidence(bundle).length,
    now,
  })

  const ruleTrace: RuleTrace = {
    ruleSetVersion: RULE_SET.version,
    evaluatedAt: now,
    steps: [...suggestion.trace.steps, ...deadlineTrace(deadlines)],
  }

  const completenessInput = { bundle, clock, determinations: dets, evaluations, decision, deadlines, standing }
  const completeness = computeCompleteness(completenessInput)
  const gaps = detectGaps(completenessInput, completeness)
  const quality = checkQuality(completenessInput)
  const status = deriveStatus(bundle, clock, decision, standing)

  const pendingReviews = bundle.reports
    .filter((r) => r.stage === 'INTERNAL_REVIEW')
    .map((r) => ({ reportId: r.id, kind: r.kind, stage: r.stage }))

  const health = deriveHealth(status, completeness, quality, deadlines, pendingReviews.length)
  const explanation = explain(bundle, clock, transitional, deadlines, dets, evaluations, suggestion, decision)

  return {
    now,
    status,
    clock,
    transitional,
    deadlines,
    nextDeadline: nextDeadline(deadlines),
    determinations: Object.fromEntries(dets),
    evaluations: Object.fromEntries(evaluations),
    decision,
    decisionStanding: standing,
    suggestion,
    ruleTrace,
    completeness,
    gaps,
    quality,
    health,
    explanation,
    pendingReviews,
  }
}

function deriveHealth(
  status: CaseStatus,
  completeness: Completeness,
  quality: QualityFinding[],
  deadlines: Deadline[],
  pendingReviewCount: number,
): CaseHealth {
  const errors = quality.filter((q) => q.severity === 'error')
  const overdue = deadlines.filter((d) => d.status === 'OVERDUE')
  if (errors.length > 0) {
    return {
      state: 'BLOCKED',
      reason: `${errors.length} data-quality error${errors.length > 1 ? 's' : ''}: ${errors[0]!.title.toLowerCase()}. Correct the record before relying on it.`,
    }
  }
  if (overdue.length > 0) {
    return { state: 'BLOCKED', reason: `${overdue[0]!.label} deadline passed without a recorded submission.` }
  }
  if (pendingReviewCount > 0) {
    return { state: 'UNDER_REVIEW', reason: `${pendingReviewCount} report version${pendingReviewCount > 1 ? 's' : ''} awaiting internal review.` }
  }
  if (completeness.missing.length > 0) {
    return {
      state: 'INCOMPLETE',
      reason: `${completeness.missing.length} required evidence item${completeness.missing.length > 1 ? 's' : ''} missing: ${completeness.missing.map((m) => m.label.toLowerCase()).join(', ')}.`,
    }
  }
  if (status === 'CLOSED') return { state: 'READY', reason: 'Case closed with a complete record.' }
  return { state: 'READY', reason: 'All applicable evidence is on the record and no data-quality errors are open.' }
}

function explain(
  bundle: CaseBundle,
  clock: ClockOfRecord,
  transitional: TransitionalEvaluation,
  deadlines: Deadline[],
  dets: Map<string, Determination>,
  evaluations: Map<string, AffectednessEvaluation>,
  suggestion: ReportabilitySuggestion,
  decision: Decision | null,
): ExplanationStep[] {
  const v = bundle.vulnerability
  const steps: ExplanationStep[] = []
  const detection = clock.stages[1]?.event
  steps.push({
    n: 1,
    title: 'Vulnerability identified',
    statement: `${v.cve ?? v.id} -- ${v.title}. Reported by ${v.source}.`,
    state: 'established',
    evidenceIds: [...new Set([...(detection ? eventEvidenceIds(bundle, detection.current) : []), ...bundle.evidence.filter((e) => e.type === 'VENDOR_ADVISORY').map((e) => e.id)])],
    refs: [v.id, ...(detection ? [detection.original.id] : [])],
    tab: 'overview',
  })

  const present = [...dets.values()].filter((d) => d.answers.component_present.answer === 'YES')
  const component = bundle.components.find((c) => c.id === v.componentId)
  steps.push({
    n: 2,
    title: 'Product contains affected component',
    statement:
      present.length > 0
        ? `${present.map((d) => bundle.products.find((p) => p.id === d.productId)?.name).join(', ')} ship${present.length === 1 ? 's' : ''} ${component?.name ?? 'the component'} in the vulnerable range.`
        : dets.size === 0
          ? 'No product determination recorded yet.'
          : 'No product is recorded as containing the vulnerable component.',
    state: present.length > 0 ? 'established' : dets.size === 0 ? 'pending' : 'not_established',
    evidenceIds: present.flatMap((d) => [...d.answers.component_present.evidenceIds, ...d.answers.vulnerable_version.evidenceIds]),
    refs: present.map((d) => d.id),
    tab: 'products',
  })

  const affected = [...evaluations.entries()].filter(([, e]) => e.result === 'AFFECTED')
  const allDets = [...dets.values()]
  steps.push({
    n: 3,
    title: 'Product configuration exposes vulnerable functionality',
    statement:
      affected.length > 0
        ? `${affected.map(([pid, e]) => `${bundle.products.find((p) => p.id === pid)?.name}: ${e.headline.toLowerCase()}`).join('; ')}.`
        : suggestion.aggregateAffectedness === 'NOT_AFFECTED'
          ? `Not exposed: ${[...evaluations.entries()].map(([pid, e]) => `${bundle.products.find((p) => p.id === pid)?.name} -- ${e.headline.toLowerCase()}`).join('; ')}.`
          : 'Exposure not yet established for any product.',
    state: affected.length > 0 ? 'established' : suggestion.aggregateAffectedness === 'NOT_AFFECTED' ? 'not_established' : 'pending',
    evidenceIds: [...new Set(allDets.flatMap((d) => determinationEvidenceIds(bundle, d)))],
    refs: allDets.map((d) => d.id),
    tab: 'products',
  })

  const expEvidence = exploitationEvidence(bundle)
  steps.push({
    n: 4,
    title: 'Active exploitation confirmed',
    statement: suggestion.exploitationEstablished
      ? `Reliable evidence of exploitation by a malicious actor (Art. 3(42)): ${expEvidence.length} item(s).`
      : `Exploitation is ${v.exploitation.replace(/_/g, ' ').toLowerCase()}${v.exploitation === 'CONFIRMED' ? ' but not evidenced' : ''}.`,
    state: suggestion.exploitationEstablished ? 'established' : v.exploitation === 'NOT_OBSERVED' ? 'not_established' : 'pending',
    evidenceIds: expEvidence.map((e) => e.id),
    refs: bundle.threatIntel.map((t) => t.id),
    tab: 'evidence',
  })

  const va = clock.vulnerabilityAwareness
  const ea = clock.exploitationAwareness
  const criterion = (id: string | null) => bundle.criteria.find((c) => c.id === id)?.label
  steps.push({
    n: 5,
    title: 'Manufacturer awareness established',
    statement: ea
      ? `Vulnerability awareness ${va ? `${va.occurredAt} (${criterion(va.current.criterionId) ?? 'criterion'})` : 'not separately recorded'}; exploitation awareness ${ea.occurredAt} (${criterion(ea.current.criterionId) ?? 'criterion'}).`
      : va
        ? `Vulnerability awareness ${va.occurredAt} (${criterion(va.current.criterionId) ?? 'criterion'}). Exploitation awareness not established.`
        : 'No awareness criterion has been met.',
    state: ea ? 'established' : va ? 'pending' : 'not_established',
    evidenceIds: [...(va ? eventEvidenceIds(bundle, va.original) : []), ...(ea ? eventEvidenceIds(bundle, ea.original) : [])],
    refs: [va?.original.id, ea?.original.id].filter((x): x is string => !!x),
    tab: 'clock',
  })

  steps.push({
    n: 6,
    title: 'Rule applicability evaluated',
    statement: `${transitional.trace.result}. ${transitional.reasoning[0] ?? ''}`,
    state:
      transitional.result === 'APPLICABLE'
        ? 'established'
        : transitional.result === 'NOT_APPLICABLE_PRE_APPLICATION'
          ? 'not_applicable'
          : 'pending',
    evidenceIds: [],
    refs: [transitional.trace.ruleId],
    tab: 'determination',
  })

  const ewDeadline = deadlines.find((d) => d.kind === 'EARLY_WARNING')!
  steps.push({
    n: 7,
    title: 'Reporting clock created',
    statement: clock.awarenessInstant && transitional.result === 'APPLICABLE'
      ? `Clock started at ${clock.awarenessInstant} from ${ewDeadline.start?.eventId ?? 'the awareness event'}.`
      : 'No reporting clock: ' + ewDeadline.reason.charAt(0).toLowerCase() + ewDeadline.reason.slice(1),
    state: clock.awarenessInstant && transitional.result === 'APPLICABLE' ? 'established' : ewDeadline.status === 'NOT_APPLICABLE' ? 'not_applicable' : 'pending',
    evidenceIds: [],
    refs: ewDeadline.start ? [ewDeadline.start.eventId] : [],
    tab: 'clock',
  })

  const live = deadlines.filter((d) => d.dueAt)
  steps.push({
    n: 8,
    title: 'Deadline calculated',
    statement:
      live.length > 0
        ? live.map((d) => `${d.label}: ${d.dueAt} (${d.status.replace(/_/g, ' ').toLowerCase()})`).join('; ') + '.'
        : decision?.outcome === 'DO_NOT_REPORT'
          ? `No deadlines: decision ${decision.id} records that reporting is not required.`
          : 'No deadline can be calculated yet.',
    state: live.length > 0 ? 'established' : decision?.outcome === 'DO_NOT_REPORT' ? 'not_applicable' : 'pending',
    evidenceIds: [],
    refs: live.map((d) => d.ruleId),
    tab: 'clock',
  })

  return steps
}
