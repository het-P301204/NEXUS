import type {
  AffectednessResult,
  Determination,
  ExploitationStatus,
  Iso,
  NonReportReason,
  Product,
  RuleTrace,
  RuleTraceStep,
  Vulnerability,
} from '../../types/domain.ts'
import { RULE_IDS, RULE_SET } from '../../rules/cra-article14.ts'
import type { ClockOfRecord } from './clock.ts'
import type { TransitionalEvaluation } from './transitional.ts'

/**
 * Reportability rule evaluation.
 *
 * Produces a *suggested* outcome and the trace that led to it. The suggestion
 * is decision support: the analyst records the decision, and may diverge from
 * the suggestion if they record why. A suggestion never stops a clock; only a
 * recorded decision does.
 *
 * Reportable when there exists a product that is
 *   made available in the EU  AND  AFFECTED
 * and the vulnerability is
 *   actively exploited (reliable evidence)  AND  Article 14 applicable.
 */

export type SuggestedOutcome = 'REPORT' | 'DO_NOT_REPORT' | 'PENDING'

export interface ProductVerdict {
  productId: string
  name: string
  version: string
  inScope: boolean
  result: AffectednessResult | 'NO_DETERMINATION'
  determinationId: string | null
}

export interface ReportabilitySuggestion {
  outcome: SuggestedOutcome
  nonReportReason: NonReportReason | null
  headline: string
  unresolved: string[]
  perProduct: ProductVerdict[]
  aggregateAffectedness: AffectednessResult
  exploitation: ExploitationStatus
  exploitationEstablished: boolean
  trace: RuleTrace
}

export interface ReportabilityInputs {
  vulnerability: Vulnerability
  products: Product[]
  /** Current (non-superseded) determination per product id. */
  determinations: Map<string, Determination>
  clock: ClockOfRecord
  transitional: TransitionalEvaluation
  exploitationEvidenceCount: number
  now: Iso
}

export const NON_REPORT_REASON_LABELS: Record<NonReportReason, string> = {
  NOT_AFFECTED: 'No in-scope product is affected',
  NO_ACTIVE_EXPLOITATION: 'No active exploitation',
  TRANSITIONAL_PRE_APPLICATION: 'Awareness precedes Article 14 application',
  NOT_MADE_AVAILABLE_IN_EU: 'No affected product is made available in the EU',
  OTHER: 'Other (see rationale)',
}

export function aggregateAffectedness(verdicts: ProductVerdict[]): AffectednessResult {
  const inScope = verdicts.filter((v) => v.inScope)
  const pool = inScope.length > 0 ? inScope : verdicts
  if (pool.some((v) => v.result === 'AFFECTED')) return 'AFFECTED'
  if (pool.length > 0 && pool.every((v) => v.result === 'NOT_AFFECTED')) return 'NOT_AFFECTED'
  return 'UNDER_INVESTIGATION'
}

export function evaluateReportability(input: ReportabilityInputs): ReportabilitySuggestion {
  const { vulnerability, products, determinations, clock, transitional, now } = input
  const steps: RuleTraceStep[] = []

  // 1. Awareness
  const va = clock.vulnerabilityAwareness
  const ea = clock.exploitationAwareness
  steps.push({
    ruleId: RULE_IDS.awareness,
    label: 'Manufacturer awareness',
    inputs: {
      'Vulnerability awareness': va ? `${va.occurredAt} (${va.original.id})` : null,
      'Exploitation awareness': ea ? `${ea.occurredAt} (${ea.original.id})` : null,
    },
    result: ea ? 'Established' : va ? 'Vulnerability awareness only' : 'Not established',
    detail: ea
      ? `Awareness of an actively exploited vulnerability at ${clock.awarenessInstant}.`
      : va
        ? 'The vulnerability is known; its active exploitation is not established.'
        : 'No awareness criterion has been met.',
    state: ea ? 'pass' : 'pending',
  })

  // 2. Active exploitation (Art. 3(42))
  const exploitation = vulnerability.exploitation
  const exploitationEstablished = exploitation === 'CONFIRMED' && input.exploitationEvidenceCount > 0
  steps.push({
    ruleId: RULE_IDS.exploitation,
    label: 'Active exploitation',
    inputs: {
      'Exploitation status': exploitation,
      'Exploitation evidence items': String(input.exploitationEvidenceCount),
    },
    result: exploitationEstablished
      ? 'Established -- reliable evidence'
      : exploitation === 'CONFIRMED'
        ? 'Confirmed but unevidenced'
        : exploitation === 'NOT_OBSERVED'
          ? 'Not observed'
          : exploitation === 'SUSPECTED'
            ? 'Suspected -- below the Art. 3(42) bar'
            : 'Unknown',
    detail:
      exploitation === 'CONFIRMED' && !exploitationEstablished
        ? 'Status is CONFIRMED but no exploitation evidence is linked. Art. 3(42) requires reliable evidence.'
        : exploitation === 'SUSPECTED'
          ? 'Suspected exploitation does not meet the reliable-evidence bar. Establish it or rule it out.'
          : exploitation === 'NOT_OBSERVED'
            ? 'No exploitation observed. Article 14(1) is not triggered by this vulnerability as it stands.'
            : exploitationEstablished
              ? 'Reliable evidence of exploitation by a malicious actor is on the record.'
              : 'Exploitation status has not been assessed.',
    state: exploitationEstablished ? 'pass' : exploitation === 'NOT_OBSERVED' ? 'fail' : 'pending',
  })

  // 3. Affectedness per product
  const perProduct: ProductVerdict[] = products.map((p) => {
    const d = determinations.get(p.id) ?? null
    return {
      productId: p.id,
      name: p.name,
      version: p.version,
      inScope: p.madeAvailableInEu,
      result: d ? d.result : 'NO_DETERMINATION',
      determinationId: d?.id ?? null,
    }
  })
  const aggregate = aggregateAffectedness(perProduct)
  const affectedInScope = perProduct.filter((v) => v.inScope && v.result === 'AFFECTED')
  const unresolvedInScope = perProduct.filter(
    (v) => v.inScope && (v.result === 'UNDER_INVESTIGATION' || v.result === 'NO_DETERMINATION'),
  )
  steps.push({
    ruleId: RULE_IDS.affectedness,
    label: 'Product affectedness',
    inputs: Object.fromEntries(
      perProduct.map((v) => [
        `${v.name} ${v.version}`,
        `${v.result.replace(/_/g, ' ')}${v.determinationId ? ` (${v.determinationId})` : ''}`,
      ]),
    ),
    result: aggregate.replace(/_/g, ' '),
    detail:
      aggregate === 'AFFECTED'
        ? `${affectedInScope.length} in-scope product(s) affected.`
        : aggregate === 'NOT_AFFECTED'
          ? 'Every product in the case is determined NOT AFFECTED.'
          : `${unresolvedInScope.length} product(s) without a final determination. Under investigation is not a pass.`,
    state: aggregate === 'AFFECTED' ? 'pass' : aggregate === 'NOT_AFFECTED' ? 'fail' : 'pending',
  })

  // 4. Transitional
  steps.push(transitional.trace)

  // 5. Scope
  const anyInScope = perProduct.some((v) => v.inScope)
  steps.push({
    ruleId: RULE_IDS.scope,
    label: 'Made available in the EU',
    inputs: Object.fromEntries(perProduct.map((v) => [`${v.name} ${v.version}`, v.inScope ? 'Yes' : 'No'])),
    result: anyInScope ? 'In scope' : 'No product made available in the EU',
    detail: anyInScope
      ? 'At least one product in the case is made available on the Union market.'
      : 'No product in the case is made available in the EU.',
    state: anyInScope ? 'pass' : 'fail',
  })

  // Outcome: any decisive negative wins, then all-positive, else pending.
  let outcome: SuggestedOutcome
  let reason: NonReportReason | null = null
  const unresolved: string[] = []
  let headline: string

  if (exploitation === 'NOT_OBSERVED') {
    outcome = 'DO_NOT_REPORT'
    reason = 'NO_ACTIVE_EXPLOITATION'
    headline = 'No active exploitation: Article 14(1) not triggered'
  } else if (transitional.result === 'NOT_APPLICABLE_PRE_APPLICATION') {
    outcome = 'DO_NOT_REPORT'
    reason = 'TRANSITIONAL_PRE_APPLICATION'
    headline = 'Both awareness dates precede 11 September 2026'
  } else if (!anyInScope) {
    outcome = 'DO_NOT_REPORT'
    reason = 'NOT_MADE_AVAILABLE_IN_EU'
    headline = 'No product in the case is made available in the EU'
  } else if (affectedInScope.length === 0 && unresolvedInScope.length === 0) {
    outcome = 'DO_NOT_REPORT'
    reason = 'NOT_AFFECTED'
    headline = 'No in-scope product is affected'
  } else if (exploitationEstablished && transitional.result === 'APPLICABLE' && affectedInScope.length > 0) {
    outcome = 'REPORT'
    headline = 'Reportable: actively exploited vulnerability in an affected product'
  } else {
    outcome = 'PENDING'
    if (!exploitationEstablished) {
      unresolved.push(
        exploitation === 'CONFIRMED'
          ? 'Exploitation is marked CONFIRMED but no exploitation evidence is linked.'
          : `Exploitation is ${exploitation.toLowerCase().replace(/_/g, ' ')}; it must be established or ruled out.`,
      )
    }
    if (transitional.result === 'INDETERMINATE') unresolved.push('No awareness event recorded.')
    if (transitional.result === 'NO_EXPLOITATION_AWARENESS' && exploitationEstablished) {
      unresolved.push('Exploitation is evidenced, but exploitation awareness has not been established against a criterion.')
    }
    if (affectedInScope.length === 0) {
      for (const v of unresolvedInScope) {
        unresolved.push(
          v.result === 'NO_DETERMINATION'
            ? `${v.name} ${v.version}: no affectedness determination recorded.`
            : `${v.name} ${v.version}: under investigation (${v.determinationId}).`,
        )
      }
    }
    headline = 'Determination pending'
  }

  steps.push({
    ruleId: 'OUTCOME',
    label: 'Applicability',
    inputs: {
      'Active exploitation': exploitationEstablished ? 'Established' : exploitation,
      Affectedness: aggregate.replace(/_/g, ' '),
      'Effective date': transitional.result.replace(/_/g, ' '),
      Scope: anyInScope ? 'In scope' : 'Out of scope',
    },
    result:
      outcome === 'REPORT' ? 'Suggested: REPORT' : outcome === 'DO_NOT_REPORT' ? 'Suggested: REPORTING NOT REQUIRED' : 'PENDING',
    detail: outcome === 'PENDING' ? unresolved.join(' ') : headline,
    state: outcome === 'REPORT' ? 'pass' : outcome === 'DO_NOT_REPORT' ? 'fail' : 'pending',
  })

  return {
    outcome,
    nonReportReason: reason,
    headline,
    unresolved,
    perProduct,
    aggregateAffectedness: aggregate,
    exploitation,
    exploitationEstablished,
    trace: { ruleSetVersion: RULE_SET.version, evaluatedAt: now, steps },
  }
}
