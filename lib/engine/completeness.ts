import type { Decision, Determination, Evidence } from '../../types/domain.ts'
import type { CaseBundle } from './bundle.ts'
import {
  VULNERABILITY_EVIDENCE_TYPES,
  determinationEvidenceIds,
  eventEvidenceIds,
  exploitationEvidence,
  linkedEvidenceIds,
} from './bundle.ts'
import type { ClockOfRecord } from './clock.ts'
import type { Deadline, DecisionStanding } from './deadlines.ts'
import { isRunning } from './deadlines.ts'
import type { AffectednessEvaluation } from './affectedness.ts'
import { STEP_BY_ID } from './affectedness.ts'

/**
 * Evidence completeness.
 *
 * A checklist of evidence the case requires in its current state, not a
 * score. Each item is satisfied, missing, or not applicable -- and says why.
 * The summary is a count of real items ("5 of 6 applicable items"), never a
 * percentage invented to look precise.
 */

export type ChecklistState = 'satisfied' | 'missing' | 'not_applicable'

export type ChecklistId =
  | 'vulnerability'
  | 'affectedness'
  | 'exploitation'
  | 'awareness'
  | 'rationale'
  | 'deadline_source'
  | 'submission'

export interface ChecklistItem {
  id: ChecklistId
  label: string
  state: ChecklistState
  detail: string
  evidenceIds: string[]
  /** Blocks finalising the determination when missing. */
  blocksDetermination: boolean
  nextAction: string | null
  tab: string
}

export interface Completeness {
  items: ChecklistItem[]
  satisfied: number
  applicable: number
  missing: ChecklistItem[]
}

export interface Gap {
  id: string
  label: string
  detail: string
  nextAction: string
  tab: string
}

export interface GapReport {
  gaps: Gap[]
  canFinalize: boolean
  blockingSummary: string | null
}

export interface CompletenessInputs {
  bundle: CaseBundle
  clock: ClockOfRecord
  determinations: Map<string, Determination>
  evaluations: Map<string, AffectednessEvaluation>
  decision: Decision | null
  deadlines: Deadline[]
  standing?: DecisionStanding | null
}

export function computeCompleteness(input: CompletenessInputs): Completeness {
  const { bundle, clock, determinations, decision, deadlines } = input
  const items: ChecklistItem[] = []

  // 1. Vulnerability evidence
  const vulnIds = new Set<string>([
    ...linkedEvidenceIds(bundle, 'vulnerability', bundle.vulnerability.id),
    ...bundle.evidence.filter((e) => VULNERABILITY_EVIDENCE_TYPES.includes(e.type)).map((e) => e.id),
  ])
  for (const e of clock.byType.DETECTION ?? []) for (const id of eventEvidenceIds(bundle, e.current)) vulnIds.add(id)
  items.push({
    id: 'vulnerability',
    label: 'Vulnerability evidence',
    state: vulnIds.size > 0 ? 'satisfied' : 'missing',
    detail:
      vulnIds.size > 0
        ? `${vulnIds.size} item(s): advisory, scanner result, ticket or detection evidence.`
        : 'No advisory, scanner result or detection evidence is on the record.',
    evidenceIds: [...vulnIds],
    blocksDetermination: true,
    nextAction: vulnIds.size > 0 ? null : 'Attach the vendor advisory or the detection signal.',
    tab: 'evidence',
  })

  // 2. Affectedness evidence -- every product needs a determination with evidence.
  const affIds = new Set<string>()
  const lacking: string[] = []
  for (const p of bundle.products) {
    const d = determinations.get(p.id)
    if (!d) {
      lacking.push(`${p.name}: no determination`)
      continue
    }
    const ids = determinationEvidenceIds(bundle, d)
    if (ids.length === 0) lacking.push(`${p.name}: determination ${d.id} has no evidence`)
    for (const id of ids) affIds.add(id)
  }
  items.push({
    id: 'affectedness',
    label: 'Affectedness evidence',
    state: lacking.length === 0 && bundle.products.length > 0 ? 'satisfied' : 'missing',
    detail: lacking.length === 0 ? `${affIds.size} item(s) across ${bundle.products.length} product determination(s).` : lacking.join('; ') + '.',
    evidenceIds: [...affIds],
    blocksDetermination: true,
    nextAction: lacking.length === 0 ? null : 'Record a determination for each product and link SBOM or configuration evidence.',
    tab: 'products',
  })

  // 3. Exploitation evidence
  const exp = exploitationEvidence(bundle)
  items.push({
    id: 'exploitation',
    label: 'Exploitation evidence',
    state: exp.length > 0 ? 'satisfied' : 'missing',
    detail:
      exp.length > 0
        ? `${exp.length} item(s) supporting the exploitation assessment (${bundle.vulnerability.exploitation.replace(/_/g, ' ')}).`
        : `The exploitation assessment (${bundle.vulnerability.exploitation.replace(/_/g, ' ')}) has no supporting evidence.`,
    evidenceIds: exp.map((e) => e.id),
    blocksDetermination: true,
    nextAction: exp.length > 0 ? null : 'Collect exploitation evidence: threat intelligence, incident record or exploit validation.',
    tab: 'evidence',
  })

  // 4. Awareness evidence
  const awarenessEvents = [...(clock.byType.VULNERABILITY_AWARENESS ?? []), ...(clock.byType.EXPLOITATION_AWARENESS ?? [])]
  const awIds = new Set<string>()
  const awLacking: string[] = []
  for (const e of awarenessEvents) {
    const ids = [...eventEvidenceIds(bundle, e.original), ...e.corrections.flatMap((c) => eventEvidenceIds(bundle, c))]
    if (ids.length === 0) awLacking.push(`${e.original.id} has no evidence`)
    for (const id of ids) awIds.add(id)
  }
  items.push({
    id: 'awareness',
    label: 'Awareness evidence',
    state: awarenessEvents.length > 0 && awLacking.length === 0 ? 'satisfied' : 'missing',
    detail:
      awarenessEvents.length === 0
        ? 'No awareness event has been recorded.'
        : awLacking.length === 0
          ? `${awarenessEvents.length} awareness event(s), each with evidence of the criterion being met.`
          : awLacking.join('; ') + '.',
    evidenceIds: [...awIds],
    blocksDetermination: true,
    nextAction:
      awarenessEvents.length === 0
        ? 'Establish awareness against a configured criterion.'
        : awLacking.length > 0
          ? 'Link evidence showing the awareness criterion was met.'
          : null,
    tab: 'clock',
  })

  // 5. Decision rationale
  const hasRationale = !!decision && decision.rationale.trim().length >= 40
  items.push({
    id: 'rationale',
    label: 'Decision rationale',
    state: hasRationale ? 'satisfied' : 'missing',
    detail: decision
      ? hasRationale
        ? `Decision ${decision.id} (${decision.outcome.replace(/_/g, ' ')}) with recorded rationale.`
        : `Decision ${decision.id} has no substantive rationale.`
      : 'No reportability decision recorded.',
    evidenceIds: decision ? decision.evidenceIds : [],
    blocksDetermination: false,
    nextAction: hasRationale ? null : 'Record the reportability decision with its rationale.',
    tab: 'determination',
  })

  // 6. Deadline source -- only when a deadline is live or was met.
  const clockDeadlines = deadlines.filter((d) => d.kind !== 'FINAL_REPORT')
  const deadlineApplies = clockDeadlines.some((d) => isRunning(d) || d.status === 'COMPLETED' || d.status === 'COMPLETED_LATE')
  if (!deadlineApplies) {
    items.push({
      id: 'deadline_source',
      label: 'Deadline source',
      state: 'not_applicable',
      detail: 'No reporting deadline applies in the current state.',
      evidenceIds: [],
      blocksDetermination: false,
      nextAction: null,
      tab: 'clock',
    })
  } else {
    const startId = clockDeadlines.find((d) => d.start)?.start?.eventId
    const startEvent = bundle.events.find((e) => e.id === startId)
    const ids = startEvent ? eventEvidenceIds(bundle, startEvent) : []
    const authoritative = !!startEvent && startEvent.sourceKind !== 'analyst_attestation'
    const ok = !!startEvent && startEvent.source.trim().length > 0 && (authoritative || ids.length > 0)
    items.push({
      id: 'deadline_source',
      label: 'Deadline source',
      state: ok ? 'satisfied' : 'missing',
      detail: ok
        ? `Clock start ${startEvent!.id} is sourced from ${startEvent!.source}.`
        : 'The event that starts the clock rests on analyst attestation alone, with no corroborating evidence.',
      evidenceIds: ids,
      blocksDetermination: false,
      nextAction: ok ? null : 'Corroborate the clock-start timestamp with a system-of-record source.',
      tab: 'clock',
    })
  }

  // 7. Submission evidence -- only when the decision is to report.
  if (decision?.outcome !== 'REPORT') {
    items.push({
      id: 'submission',
      label: 'Submission evidence',
      state: 'not_applicable',
      detail: decision ? 'The recorded decision is that reporting is not required.' : 'No decision to report has been recorded.',
      evidenceIds: [],
      blocksDetermination: false,
      nextAction: null,
      tab: 'report',
    })
  } else {
    const ew = clock.earlyWarningSubmitted
    const ids = ew ? eventEvidenceIds(bundle, ew.original) : []
    const receipts = bundle.evidence.filter((e: Evidence) => e.type === 'SUBMISSION_RECEIPT' && ids.includes(e.id))
    items.push({
      id: 'submission',
      label: 'Submission evidence',
      state: ew && receipts.length > 0 ? 'satisfied' : 'missing',
      detail: ew
        ? receipts.length > 0
          ? `Early warning ${ew.original.id} with submission receipt ${receipts[0]!.id}.`
          : `Early warning ${ew.original.id} recorded without a receipt.`
        : 'The early warning has not been submitted.',
      evidenceIds: ids,
      blocksDetermination: false,
      nextAction: ew ? null : 'Generate, approve and submit the early warning report.',
      tab: 'report',
    })
  }

  const applicable = items.filter((i) => i.state !== 'not_applicable')
  return {
    items,
    satisfied: applicable.filter((i) => i.state === 'satisfied').length,
    applicable: applicable.length,
    missing: applicable.filter((i) => i.state === 'missing'),
  }
}

/**
 * Evidence gap detection: what is missing, why the determination cannot be
 * finalised, and what to do next. Never resolves anything on its own.
 */
export function detectGaps(input: CompletenessInputs, completeness: Completeness): GapReport {
  const gaps: Gap[] = []
  for (const item of completeness.missing) {
    if (!item.blocksDetermination) continue
    gaps.push({
      id: `gap-${item.id}`,
      label: item.label,
      detail: item.detail,
      nextAction: item.nextAction ?? 'Review the evidence register.',
      tab: item.tab,
    })
  }
  // Determination-specific gaps: what each under-investigation product is blocked on.
  for (const [productId, evaluation] of input.evaluations) {
    if (evaluation.result !== 'UNDER_INVESTIGATION' || !evaluation.decidingStep) continue
    const product = input.bundle.products.find((p) => p.id === productId)
    const step = STEP_BY_ID[evaluation.decidingStep]
    const action =
      step.id === 'configuration_mitigates'
        ? 'Validate production configuration'
        : step.id === 'product_validation'
          ? 'Complete product-specific validation'
          : step.id === 'feature_reachable' || step.id === 'exploit_path'
            ? 'Establish reachability of the vulnerable code path'
            : step.id === 'component_present'
              ? 'Confirm component presence from a current SBOM'
              : `Resolve step ${step.n}`
    gaps.push({
      id: `gap-det-${productId}`,
      label: `${product?.name ?? productId}: ${evaluation.headline}`,
      detail: evaluation.reasons.join(' '),
      nextAction: action,
      tab: 'products',
    })
  }
  const blocking = gaps.length > 0
  return {
    gaps,
    canFinalize: !blocking,
    blockingSummary: blocking ? 'Cannot finalize determination.' : null,
  }
}
