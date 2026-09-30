import type { Decision, Determination } from '../../types/domain.ts'
import type { AffectednessEvaluation } from './affectedness.ts'
import type { CaseBundle } from './bundle.ts'
import { determinationEvidenceIds, eventEvidenceIds } from './bundle.ts'
import type { ClockOfRecord } from './clock.ts'
import type { Deadline, DecisionStanding } from './deadlines.ts'
import { isRunning } from './deadlines.ts'
import { diffMs, formatDuration, ms } from './time.ts'

/**
 * Data-quality engine.
 *
 * Finds records that cannot all be true at once -- a decision dated before
 * the awareness it decides on, a submission before its decision -- and says
 * so. It never fixes anything: a wrong timestamp is corrected by a person,
 * through a correction event that keeps the original on the record.
 */

export type QualitySeverity = 'error' | 'warning' | 'info'

export interface QualityFinding {
  id: string
  code: string
  severity: QualitySeverity
  title: string
  detail: string
  refs: string[]
  tab: string
}

const DAY = 24 * 60 * 60 * 1000

export interface QualityInputs {
  bundle: CaseBundle
  clock: ClockOfRecord
  determinations: Map<string, Determination>
  evaluations: Map<string, AffectednessEvaluation>
  decision: Decision | null
  deadlines: Deadline[]
  standing?: DecisionStanding | null
}

export function checkQuality(input: QualityInputs): QualityFinding[] {
  const { bundle, clock, determinations, evaluations, decision, deadlines, standing } = input
  const out: QualityFinding[] = []
  const add = (f: Omit<QualityFinding, 'id'>) => out.push({ id: `${f.code}:${f.refs.join(',')}`, ...f })

  const detection = clock.stages[1]?.event ?? null
  const va = clock.vulnerabilityAwareness
  const ea = clock.exploitationAwareness
  const awareness = clock.awarenessInstant

  // Decision timestamp before awareness
  const firstDecision = [...bundle.decisions].sort((a, b) => ms(a.decidedAt) - ms(b.decidedAt))[0]
  const awarenessForDecision = awareness ?? va?.occurredAt ?? null
  if (firstDecision && awarenessForDecision && ms(firstDecision.decidedAt) < ms(awarenessForDecision)) {
    add({
      code: 'DECISION_BEFORE_AWARENESS',
      severity: 'warning',
      title: 'Decision timestamp before awareness',
      detail: `Decision ${firstDecision.id} (${firstDecision.decidedAt}) predates the awareness it decides on (${awarenessForDecision}), by ${formatDuration(diffMs(awarenessForDecision, firstDecision.decidedAt))}.`,
      refs: [firstDecision.id],
      tab: 'clock',
    })
  }

  // Submission before decision
  const ew = clock.earlyWarningSubmitted
  const firstReport = [...bundle.decisions].filter((d) => d.outcome === 'REPORT').sort((a, b) => ms(a.decidedAt) - ms(b.decidedAt))[0]
  if (ew && (!firstReport || ms(ew.occurredAt) < ms(firstReport.decidedAt))) {
    add({
      code: 'SUBMISSION_BEFORE_DECISION',
      severity: 'error',
      title: 'Submission timestamp before decision',
      detail: firstReport
        ? `Early warning ${ew.original.id} (${ew.occurredAt}) predates the decision to report (${firstReport.id}, ${firstReport.decidedAt}).`
        : `Early warning ${ew.original.id} is recorded, but no decision to report exists.`,
      refs: [ew.original.id, ...(firstReport ? [firstReport.id] : [])],
      tab: 'clock',
    })
  }

  // Final report before measure
  const fr = clock.finalReportSubmitted
  const measure = clock.measureAvailable
  if (fr && (!measure || ms(fr.occurredAt) < ms(measure.occurredAt))) {
    add({
      code: 'FINAL_BEFORE_MEASURE',
      severity: 'error',
      title: 'Final report before measure availability',
      detail: measure
        ? `Final report ${fr.original.id} predates the measure-available event ${measure.original.id}.`
        : `Final report ${fr.original.id} is recorded but no corrective or mitigating measure is.`,
      refs: [fr.original.id],
      tab: 'clock',
    })
  }

  // Awareness before detection
  if (detection && va && ms(va.occurredAt) < ms(detection.occurredAt)) {
    add({
      code: 'AWARENESS_BEFORE_DETECTION',
      severity: 'warning',
      title: 'Awareness precedes the first detection signal',
      detail: `Vulnerability awareness ${va.original.id} (${va.occurredAt}) is earlier than detection ${detection.original.id} (${detection.occurredAt}). Awareness needs a signal to be aware of.`,
      refs: [va.original.id, detection.original.id],
      tab: 'clock',
    })
  }

  // Exploitation awareness before vulnerability awareness. The record contradicts
  // itself: the clock is read strictly (from exploitation awareness) and
  // applicability conservatively (from the later date), but someone has to say
  // which event is wrong.
  if (va && ea && ms(ea.occurredAt) < ms(va.occurredAt)) {
    add({
      code: 'EXPLOITATION_BEFORE_VULNERABILITY_AWARENESS',
      severity: 'error',
      title: 'Exploitation awareness before vulnerability awareness',
      detail: `Exploitation awareness ${ea.original.id} is dated before vulnerability awareness ${va.original.id}. Knowing a vulnerability is exploited implies knowing the vulnerability, so the clock runs from ${ea.original.id}. Correct whichever event is wrong.`,
      refs: [ea.original.id, va.original.id],
      tab: 'clock',
    })
  }

  // A decision overtaken by awareness recorded or corrected after it
  if (decision && standing?.staleBy) {
    add({
      code: 'DECISION_OVERTAKEN_BY_AWARENESS',
      severity: 'error',
      title: 'Decision overtaken by later awareness',
      detail: standing.reason ?? `${decision.id} predates awareness now on record.`,
      refs: [decision.id, standing.staleBy],
      tab: 'determination',
    })
  }

  // Deadline missing its source event
  for (const d of deadlines) {
    if (!d.start || !isRunning(d)) continue
    const start = bundle.events.find((e) => e.id === d.start!.eventId)
    if (!start || start.source.trim().length === 0) {
      add({
        code: 'DEADLINE_MISSING_SOURCE',
        severity: 'error',
        title: 'Deadline missing source event',
        detail: `The ${d.label.toLowerCase()} deadline has no traceable start-event source.`,
        refs: [d.kind],
        tab: 'clock',
      })
    }
  }

  // Evidence dated after the submission it supports
  if (ew) {
    const supporting = new Set<string>()
    for (const e of [...(clock.byType.VULNERABILITY_AWARENESS ?? []), ...(clock.byType.EXPLOITATION_AWARENESS ?? [])]) {
      for (const id of eventEvidenceIds(bundle, e.original)) supporting.add(id)
    }
    if (firstReport) for (const id of firstReport.evidenceIds) supporting.add(id)
    for (const ev of bundle.evidence) {
      if (!supporting.has(ev.id) || !ev.sourceCreatedAt) continue
      if (ms(ev.sourceCreatedAt) > ms(ew.occurredAt)) {
        add({
          code: 'EVIDENCE_AFTER_SUBMISSION',
          severity: 'warning',
          title: 'Evidence timestamp after submission',
          // Findings are shown to every role, so they cite evidence by id and type, never by title.
          detail: `${ev.id} (${ev.type.replace(/_/g, ' ').toLowerCase()}) was created at ${ev.sourceCreatedAt}, after the early warning it supports (${ew.occurredAt}).`,
          refs: [ev.id],
          tab: 'evidence',
        })
      }
    }
  }

  // Affected product with no component mapping
  for (const [productId, d] of determinations) {
    if (d.result !== 'AFFECTED') continue
    const mapped =
      d.productComponentId !== null ||
      bundle.productComponents.some((pc) => pc.productId === productId && pc.componentId === bundle.vulnerability.componentId)
    if (!mapped) {
      const product = bundle.products.find((p) => p.id === productId)
      add({
        code: 'AFFECTED_WITHOUT_COMPONENT_MAPPING',
        severity: 'warning',
        title: 'Affected product with no component mapping',
        detail: `${product?.name ?? productId} is determined AFFECTED (${d.id}) but no component in its SBOM maps to the vulnerability.`,
        refs: [d.id],
        tab: 'products',
      })
    }
    if (determinationEvidenceIds(bundle, d).length === 0) {
      add({
        code: 'AFFECTED_WITHOUT_EVIDENCE',
        severity: 'info',
        title: 'Affected determination without evidence',
        detail: `${d.id} records AFFECTED with no linked evidence.`,
        refs: [d.id],
        tab: 'products',
      })
    }
  }

  // Affectedness contradictions
  for (const [productId, evaluation] of evaluations) {
    for (const c of evaluation.contradictions) {
      const d = determinations.get(productId)
      add({
        code: 'AFFECTEDNESS_CONTRADICTION',
        severity: 'error',
        title: 'Contradictory affectedness answers',
        detail: c,
        refs: [d?.id ?? productId],
        tab: 'products',
      })
    }
  }

  // Exploitation status vs awareness
  if (ea && bundle.vulnerability.exploitation !== 'CONFIRMED') {
    add({
      code: 'EXPLOITATION_STATUS_MISMATCH',
      severity: 'warning',
      title: 'Exploitation awareness without confirmed status',
      detail: `Exploitation awareness ${ea.original.id} is recorded, but the vulnerability record says exploitation is ${bundle.vulnerability.exploitation.replace(/_/g, ' ')}.`,
      refs: [ea.original.id, bundle.vulnerability.id],
      tab: 'overview',
    })
  }
  if (!ea && bundle.vulnerability.exploitation === 'CONFIRMED' && bundle.case.lifecycle === 'open') {
    add({
      code: 'CONFIRMED_WITHOUT_AWARENESS',
      severity: 'warning',
      title: 'Confirmed exploitation, no awareness event',
      detail:
        'The vulnerability record says exploitation is CONFIRMED, but no exploitation-awareness event has been recorded. The reporting clock has not been established.',
      refs: [bundle.vulnerability.id],
      tab: 'clock',
    })
  }

  // Retrospective entries: recorded long after the asserted time.
  for (const e of bundle.events) {
    if (e.sourceKind === 'nexus_server') continue
    const lag = diffMs(e.recordedAt, e.occurredAt)
    if (lag > DAY) {
      add({
        code: 'RETROSPECTIVE_ENTRY',
        severity: 'info',
        title: 'Retrospective entry',
        detail: `${e.id} (${e.type.replace(/_/g, ' ').toLowerCase()}) was recorded ${formatDuration(lag)} after the asserted time. Confirm the timestamp against its source.`,
        refs: [e.id],
        tab: 'clock',
      })
    }
  }

  // Stale SBOM behind a determination
  for (const [productId, d] of determinations) {
    const product = bundle.products.find((p) => p.id === productId)
    if (product && product.sbomStatus !== 'current' && d.answers.component_present.answer !== null) {
      add({
        code: 'SBOM_NOT_CURRENT',
        severity: 'info',
        title: 'Determination relies on a non-current SBOM',
        detail: `${product.name} ${product.version} has a ${product.sbomStatus} SBOM. Component presence in ${d.id} may not reflect the shipped build.`,
        refs: [d.id],
        tab: 'products',
      })
    }
  }

  // Divergence without rationale
  if (decision && decision.suggestedOutcome !== 'PENDING' && decision.suggestedOutcome !== decision.outcome && !decision.divergenceReason) {
    add({
      code: 'DIVERGENCE_WITHOUT_REASON',
      severity: 'error',
      title: 'Decision diverges from rule evaluation without a reason',
      detail: `${decision.id} records ${decision.outcome.replace(/_/g, ' ')} while the rule evaluation suggested ${decision.suggestedOutcome.replace(/_/g, ' ')}.`,
      refs: [decision.id],
      tab: 'determination',
    })
  }

  const rank: Record<QualitySeverity, number> = { error: 0, warning: 1, info: 2 }
  return out.sort((a, b) => rank[a.severity] - rank[b.severity])
}
