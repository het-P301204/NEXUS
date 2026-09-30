import type { Iso, RuleTraceStep } from '../../types/domain.ts'
import { BOUNDARY_REVIEW_WINDOW_MS, RULE_IDS } from '../../rules/cra-article14.ts'
import { maxIso, ms } from './time.ts'

/**
 * The two-date transitional rule.
 *
 * Article 14 applies from 11 September 2026. Whether a given vulnerability is
 * reportable under it turns on two awareness dates, not one:
 *
 *   aware of the vulnerability AND of its exploitation before the date
 *     -> Article 14 does not apply
 *   aware of the vulnerability before, of its exploitation after
 *     -> Article 14 applies; the clock starts at exploitation awareness
 *   aware of both after
 *     -> Article 14 applies
 *
 * Only the later of the two instants decides applicability. Both are kept
 * and shown, because the question an auditor asks is "which date did you use,
 * and why".
 */

export type Side = 'pre' | 'post' | 'unknown'

export type Applicability =
  | 'APPLICABLE'
  | 'NOT_APPLICABLE_PRE_APPLICATION'
  | 'NO_EXPLOITATION_AWARENESS'
  | 'INDETERMINATE'

export interface TransitionalEvaluation {
  applicationInstant: Iso
  vulnerabilityAwareAt: Iso | null
  exploitationAwareAt: Iso | null
  vulnerabilitySide: Side
  exploitationSide: Side
  triggerInstant: Iso | null
  result: Applicability
  /** Trigger within 24h of the boundary: the interpretation of the boundary instant matters. */
  nearBoundary: boolean
  reasoning: string[]
  trace: RuleTraceStep
}

function side(at: Iso | null, boundary: Iso): Side {
  if (!at) return 'unknown'
  return ms(at) < ms(boundary) ? 'pre' : 'post'
}

export function evaluateTransitional(
  vulnerabilityAwareAt: Iso | null,
  exploitationAwareAt: Iso | null,
  applicationInstant: Iso,
): TransitionalEvaluation {
  const vSide = side(vulnerabilityAwareAt, applicationInstant)
  const eSide = side(exploitationAwareAt, applicationInstant)
  const reasoning: string[] = []
  let result: Applicability
  let triggerInstant: Iso | null = null

  if (!vulnerabilityAwareAt && !exploitationAwareAt) {
    result = 'INDETERMINATE'
    reasoning.push('No awareness event has been recorded. Applicability cannot be evaluated.')
  } else if (!exploitationAwareAt) {
    result = 'NO_EXPLOITATION_AWARENESS'
    reasoning.push(
      `Vulnerability awareness recorded (${vSide === 'pre' ? 'before' : 'on or after'} the application date).`,
      'Exploitation awareness has not been established. Article 14(1) concerns actively exploited vulnerabilities, so no reporting clock exists yet.',
      'If exploitation is later confirmed, applicability is re-evaluated using that date.',
    )
  } else {
    triggerInstant = maxIso([vulnerabilityAwareAt, exploitationAwareAt])
    if (!vulnerabilityAwareAt) {
      reasoning.push(
        'No separate vulnerability-awareness event. Exploitation awareness implies awareness of the vulnerability, so it is used on its own.',
      )
    }
    if (triggerInstant && ms(triggerInstant) < ms(applicationInstant)) {
      result = 'NOT_APPLICABLE_PRE_APPLICATION'
      reasoning.push(
        'Both the vulnerability and its active exploitation were known before the application date.',
        'Article 14 obligations do not attach to this awareness.',
      )
    } else {
      result = 'APPLICABLE'
      if (vSide === 'pre' && eSide === 'post') {
        reasoning.push(
          'The vulnerability was known before the application date, but its active exploitation became known after it.',
          'Awareness of an actively exploited vulnerability therefore arises after the application date: Article 14 applies.',
        )
      } else if (vSide === 'post' && eSide === 'pre') {
        reasoning.push(
          'Exploitation awareness is dated before vulnerability awareness. That ordering is inconsistent and is raised as a data-quality warning.',
          'The later instant falls after the application date: Article 14 applies.',
        )
      } else {
        reasoning.push('Awareness of the actively exploited vulnerability arises on or after the application date: Article 14 applies.')
      }
    }
  }

  const nearBoundary =
    triggerInstant !== null && Math.abs(ms(triggerInstant) - ms(applicationInstant)) < BOUNDARY_REVIEW_WINDOW_MS
  if (nearBoundary) {
    reasoning.push(
      'The trigger instant falls within 24 hours of the application boundary. How the boundary instant is interpreted changes the outcome. Counsel review recommended.',
    )
  }

  const trace: RuleTraceStep = {
    ruleId: RULE_IDS.transitional,
    label: 'Effective-date evaluation',
    inputs: {
      'Application instant': applicationInstant,
      'Vulnerability awareness': vulnerabilityAwareAt,
      'Exploitation awareness': exploitationAwareAt,
      'Trigger (later of the two)': triggerInstant,
    },
    result:
      result === 'APPLICABLE'
        ? 'Applicable'
        : result === 'NOT_APPLICABLE_PRE_APPLICATION'
          ? 'Not applicable -- both dates precede application'
          : result === 'NO_EXPLOITATION_AWARENESS'
            ? 'Pending -- exploitation awareness not established'
            : 'Indeterminate -- no awareness recorded',
    detail: reasoning.join(' '),
    state:
      result === 'APPLICABLE' ? 'pass' : result === 'NOT_APPLICABLE_PRE_APPLICATION' ? 'fail' : 'pending',
  }

  return {
    applicationInstant,
    vulnerabilityAwareAt,
    exploitationAwareAt,
    vulnerabilitySide: vSide,
    exploitationSide: eSide,
    triggerInstant,
    result,
    nearBoundary,
    reasoning,
    trace,
  }
}
