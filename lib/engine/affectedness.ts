import type {
  AffectednessResult,
  AffectednessStepId,
  Answer,
  Component,
  Product,
  ProductComponent,
  StepAnswer,
  VexJustification,
  VexStatus,
  Vulnerability,
} from '../../types/domain.ts'
import { inRange } from './versions.ts'

/**
 * The affectedness engine.
 *
 * "Contains the vulnerable component" and "is affected" are different claims.
 * The first comes from an SBOM; the second needs product-specific analysis.
 * Nine ordered questions separate them, and the engine walks them in order:
 *
 *   1-5  exposure    a NO decides NOT AFFECTED (with a VEX justification),
 *                    an UNKNOWN decides UNDER INVESTIGATION
 *   6    mitigation  a YES decides NOT AFFECTED (inline mitigation)
 *   7    compensating control -- recorded, never changes affectedness
 *   8    exploitation demonstrated against this product -- decides AFFECTED
 *   9    product-specific validation -- required for any NOT AFFECTED
 *
 * NEXUS never infers safety. A NOT AFFECTED result also needs evidence on
 * the answer that decided it. Without it, the result is UNDER INVESTIGATION.
 */

export interface StepDefinition {
  id: AffectednessStepId
  n: number
  question: string
  help: string
  /** The answer that ends the walk with NOT AFFECTED, if any. */
  exitAnswer: Answer | null
  justification: VexJustification | null
  group: 'exposure' | 'mitigation' | 'context' | 'validation'
}

export const STEPS: StepDefinition[] = [
  {
    id: 'component_present',
    n: 1,
    question: 'Is the component present in the product?',
    help: 'From the SBOM or build manifest for the shipped version. A scanner match on the package name alone does not establish presence.',
    exitAnswer: 'NO',
    justification: 'component_not_present',
    group: 'exposure',
  },
  {
    id: 'vulnerable_version',
    n: 2,
    question: 'Is the shipped version within the vulnerable range?',
    help: 'Compare the exact shipped version, including vendor backports, against the advisory range.',
    exitAnswer: 'NO',
    justification: 'vulnerable_code_not_present',
    group: 'exposure',
  },
  {
    id: 'functionality_enabled',
    n: 3,
    question: 'Is the vulnerable functionality compiled in and enabled?',
    help: 'Build flags, compiled modules and feature toggles in the shipped build.',
    exitAnswer: 'NO',
    justification: 'vulnerable_code_not_present',
    group: 'exposure',
  },
  {
    id: 'feature_reachable',
    n: 4,
    question: 'Is the vulnerable code reachable in the product\'s execution path?',
    help: 'Does any product code path call into the vulnerable function under real operation?',
    exitAnswer: 'NO',
    justification: 'vulnerable_code_not_in_execute_path',
    group: 'exposure',
  },
  {
    id: 'exploit_path',
    n: 5,
    question: 'Can an adversary control the input that reaches it?',
    help: 'An exploit path exists when attacker-controlled data -- network, file or API input -- can reach the vulnerable code.',
    exitAnswer: 'NO',
    justification: 'vulnerable_code_cannot_be_controlled_by_adversary',
    group: 'exposure',
  },
  {
    id: 'configuration_mitigates',
    n: 6,
    question: 'Does the shipped configuration mitigate the issue?',
    help: 'A built-in mitigation present in every deployment by default -- not a customer-side setting.',
    exitAnswer: 'YES',
    justification: 'inline_mitigations_already_exist',
    group: 'mitigation',
  },
  {
    id: 'compensating_control',
    n: 7,
    question: 'Is a compensating control in place?',
    help: 'For example a WAF rule or a network restriction. It reduces risk but does not change affectedness, and is recorded as an action statement.',
    exitAnswer: null,
    justification: null,
    group: 'context',
  },
  {
    id: 'exploitation_demonstrated',
    n: 8,
    question: 'Has exploitation been demonstrated against this product?',
    help: 'A working exploit or observed exploitation against this product specifically, not against the component in general.',
    exitAnswer: null,
    justification: null,
    group: 'context',
  },
  {
    id: 'product_validation',
    n: 9,
    question: 'Has product-specific validation been completed?',
    help: 'Testing or code review against the shipped product and its production configuration. Required before NEXUS records NOT AFFECTED.',
    exitAnswer: null,
    justification: null,
    group: 'validation',
  },
]

export const STEP_BY_ID = Object.fromEntries(STEPS.map((s) => [s.id, s])) as Record<AffectednessStepId, StepDefinition>

export const JUSTIFICATION_LABELS: Record<VexJustification, string> = {
  component_not_present: 'Component not present',
  vulnerable_code_not_present: 'Vulnerable code not present',
  vulnerable_code_not_in_execute_path: 'Vulnerable code not in execute path',
  vulnerable_code_cannot_be_controlled_by_adversary: 'Vulnerable code cannot be controlled by adversary',
  inline_mitigations_already_exist: 'Inline mitigations already exist',
}

export type PathEffect = 'continue' | 'decides' | 'blocks' | 'noted' | 'not_reached' | 'unanswered'

export interface PathStep {
  id: AffectednessStepId
  n: number
  answer: Answer | null
  effect: PathEffect
  evidenceCount: number
  explanation: string
}

export interface AffectednessEvaluation {
  result: AffectednessResult
  vexStatus: VexStatus
  justification: VexJustification | null
  decidingStep: AffectednessStepId | null
  headline: string
  reasons: string[]
  path: PathStep[]
  contradictions: string[]
  /** Steps whose answer the result depends on but that carry no evidence. */
  missingEvidence: AffectednessStepId[]
  actionStatement: string | null
}

export function emptyAnswers(): Record<AffectednessStepId, StepAnswer> {
  const out = {} as Record<AffectednessStepId, StepAnswer>
  for (const s of STEPS) out[s.id] = { answer: null, note: '', evidenceIds: [] }
  return out
}

export function evaluateAffectedness(answers: Record<AffectednessStepId, StepAnswer>): AffectednessEvaluation {
  const a = (id: AffectednessStepId) => answers[id]?.answer ?? null
  const ev = (id: AffectednessStepId) => answers[id]?.evidenceIds.length ?? 0
  const path: PathStep[] = STEPS.map((s) => ({
    id: s.id,
    n: s.n,
    answer: a(s.id),
    effect: 'not_reached' as PathEffect,
    evidenceCount: ev(s.id),
    explanation: '',
  }))
  const at = (id: AffectednessStepId) => path[STEP_BY_ID[id].n - 1]!
  const contradictions: string[] = []
  const reasons: string[] = []

  const compensating = a('compensating_control') === 'YES'
  const actionStatement = compensating
    ? `Compensating control in place${answers.compensating_control.note ? `: ${answers.compensating_control.note.replace(/[.\s]+$/, '')}` : ''}. Affectedness is unchanged.`
    : null

  // Step 8 decides AFFECTED outright: an exploit against this product is the
  // strongest evidence there is, and any answer that says otherwise is wrong.
  if (a('exploitation_demonstrated') === 'YES') {
    for (const s of STEPS.slice(0, 5)) {
      if (a(s.id) === 'NO') {
        contradictions.push(`Step ${s.n} answers NO ("${s.question}"), but exploitation has been demonstrated against this product.`)
        at(s.id).effect = 'noted'
        at(s.id).explanation = 'Contradicted by step 8.'
      } else if (a(s.id) === 'YES') {
        at(s.id).effect = 'continue'
      } else {
        at(s.id).effect = a(s.id) === 'UNKNOWN' ? 'noted' : 'unanswered'
      }
    }
    if (a('configuration_mitigates') === 'YES') {
      contradictions.push('Step 6 says the shipped configuration mitigates the issue, but exploitation has been demonstrated against this product.')
      at('configuration_mitigates').effect = 'noted'
    }
    at('exploitation_demonstrated').effect = 'decides'
    at('exploitation_demonstrated').explanation = 'Exploitation demonstrated against this product.'
    if (compensating) at('compensating_control').effect = 'noted'
    reasons.push('Exploitation has been demonstrated against this product.')
    return finish('AFFECTED', null, 'exploitation_demonstrated', 'Exploitation demonstrated against this product')
  }

  // Steps 1-5: exposure. Walk in order; the first NO or UNKNOWN ends the walk.
  let notAffectedAt: AffectednessStepId | null = null
  for (const s of STEPS.slice(0, 5)) {
    const answer = a(s.id)
    const p = at(s.id)
    if (answer === null) {
      p.effect = 'unanswered'
      p.explanation = 'Not answered.'
      reasons.push(`Step ${s.n} is not answered: "${s.question}"`)
      return finish('UNDER_INVESTIGATION', null, s.id, `Step ${s.n} not answered`)
    }
    if (answer === 'UNKNOWN') {
      p.effect = 'blocks'
      p.explanation = 'Unknown. The walk cannot continue without it.'
      reasons.push(`Step ${s.n} is UNKNOWN: "${s.question}"`)
      return finish('UNDER_INVESTIGATION', null, s.id, `${s.question.replace(/\?$/, '')}: unknown`)
    }
    if (answer === 'NO') {
      p.effect = 'decides'
      p.explanation = `NO -- ${JUSTIFICATION_LABELS[s.justification!].toLowerCase()}.`
      notAffectedAt = s.id
      break
    }
    p.effect = 'continue'
  }

  if (!notAffectedAt) {
    const m = a('configuration_mitigates')
    const p = at('configuration_mitigates')
    if (m === null || m === 'UNKNOWN') {
      p.effect = m === null ? 'unanswered' : 'blocks'
      p.explanation = 'Exposure is established by steps 1-5; whether the shipped configuration mitigates it is not known.'
      reasons.push('Steps 1-5 establish exposure. Whether the shipped configuration mitigates it is not known.')
      if (compensating) at('compensating_control').effect = 'noted'
      return finish('UNDER_INVESTIGATION', null, 'configuration_mitigates', 'Exposure established; mitigation unknown')
    }
    if (m === 'YES') {
      p.effect = 'decides'
      p.explanation = 'YES -- inline mitigation in the shipped configuration.'
      notAffectedAt = 'configuration_mitigates'
    } else {
      p.effect = 'continue'
      p.explanation = 'NO -- the shipped configuration does not mitigate.'
      if (compensating) {
        at('compensating_control').effect = 'noted'
        at('compensating_control').explanation = 'Recorded as an action statement. Affectedness is unchanged.'
      }
      reasons.push('Present, vulnerable version, enabled, reachable, adversary-controllable, and not mitigated by configuration.')
      return finish('AFFECTED', null, 'configuration_mitigates', 'Reachable, exploitable and unmitigated')
    }
  }

  // A NOT AFFECTED candidate. It stands only with validation and evidence.
  const deciding = STEP_BY_ID[notAffectedAt]
  const justification = deciding.justification!
  if (compensating) at('compensating_control').effect = 'noted'
  const validation = at('product_validation')
  if (a('product_validation') !== 'YES') {
    validation.effect = 'blocks'
    validation.explanation = 'NOT AFFECTED is not recorded without product-specific validation.'
    reasons.push(
      `Step ${deciding.n} indicates NOT AFFECTED (${JUSTIFICATION_LABELS[justification].toLowerCase()}), but product-specific validation is not complete.`,
      'NEXUS does not record NOT AFFECTED without validation. The result stays UNDER INVESTIGATION.',
    )
    return finish('UNDER_INVESTIGATION', null, 'product_validation', 'Not affected indicated, validation incomplete')
  }
  validation.effect = 'continue'
  if (ev(notAffectedAt) === 0) {
    reasons.push(
      `Step ${deciding.n} indicates NOT AFFECTED, but the answer that decides it has no supporting evidence.`,
      'Link evidence to that answer before NEXUS records NOT AFFECTED.',
    )
    return finish('UNDER_INVESTIGATION', null, notAffectedAt, 'Not affected indicated, deciding answer lacks evidence', [
      notAffectedAt,
    ])
  }
  reasons.push(`${JUSTIFICATION_LABELS[justification]} (step ${deciding.n}), validated against the product.`)
  return finish('NOT_AFFECTED', justification, notAffectedAt, JUSTIFICATION_LABELS[justification])

  function finish(
    result: AffectednessResult,
    just: VexJustification | null,
    decidingStep: AffectednessStepId | null,
    headline: string,
    missing: AffectednessStepId[] = [],
  ): AffectednessEvaluation {
    const vexStatus: VexStatus =
      result === 'AFFECTED' ? 'affected' : result === 'NOT_AFFECTED' ? 'not_affected' : 'under_investigation'
    // Evidence the result leans on: every answered exposure step on the path.
    const missingEvidence = new Set<AffectednessStepId>(missing)
    if (result === 'AFFECTED') {
      for (const p of path) if ((p.effect === 'continue' || p.effect === 'decides') && p.evidenceCount === 0) missingEvidence.add(p.id)
    }
    return {
      result,
      vexStatus,
      justification: just,
      decidingStep,
      headline,
      reasons,
      path,
      contradictions,
      missingEvidence: [...missingEvidence],
      actionStatement,
    }
  }
}

// ---------------------------------------------------------------------------
// SBOM-backed suggestions for steps 1 and 2
// ---------------------------------------------------------------------------

export interface SbomSuggestion {
  step: 'component_present' | 'vulnerable_version'
  answer: Answer
  detail: string
}

/**
 * What the SBOM can say about steps 1 and 2 -- and nothing else. These are
 * pre-filled suggestions the analyst confirms; steps 3-9 need a human who
 * has looked at the product.
 */
export function suggestFromSbom(
  vulnerability: Vulnerability,
  product: Product,
  productComponents: ProductComponent[],
  components: Component[],
): { suggestions: SbomSuggestion[]; productComponent: ProductComponent | null } {
  const suggestions: SbomSuggestion[] = []
  if (!vulnerability.componentId) {
    return {
      suggestions: [
        {
          step: 'component_present',
          answer: 'UNKNOWN',
          detail: 'The vulnerability record names no component, so the SBOM cannot be consulted.',
        },
      ],
      productComponent: null,
    }
  }
  const component = components.find((c) => c.id === vulnerability.componentId)
  const pc = productComponents.find((x) => x.productId === product.id && x.componentId === vulnerability.componentId) ?? null
  const name = component?.name ?? vulnerability.componentId

  if (product.sbomStatus === 'missing') {
    suggestions.push({
      step: 'component_present',
      answer: 'UNKNOWN',
      detail: `No SBOM on record for ${product.name} ${product.version}. Presence of ${name} cannot be established from it.`,
    })
    return { suggestions, productComponent: pc }
  }
  if (!pc) {
    suggestions.push({
      step: 'component_present',
      answer: product.sbomStatus === 'current' ? 'NO' : 'UNKNOWN',
      detail:
        product.sbomStatus === 'current'
          ? `The current SBOM for ${product.name} ${product.version} does not list ${name}.`
          : `The SBOM for ${product.name} is stale and does not list ${name}. Regenerate it before relying on absence.`,
    })
    return { suggestions, productComponent: null }
  }
  suggestions.push({
    step: 'component_present',
    answer: 'YES',
    detail: `SBOM lists ${name} ${pc.version} (${pc.relation}${pc.relation === 'transitive' ? ' dependency' : ''}).${product.sbomStatus === 'stale' ? ' SBOM is stale.' : ''}`,
  })
  const match = inRange(pc.version, vulnerability.affectedVersions)
  suggestions.push({
    step: 'vulnerable_version',
    answer: match === null ? 'UNKNOWN' : match ? 'YES' : 'NO',
    detail:
      match === null
        ? `Version ${pc.version} could not be compared against "${vulnerability.affectedVersions}".`
        : match
          ? `${pc.version} is within the affected range ${vulnerability.affectedVersions}.`
          : `${pc.version} is outside the affected range ${vulnerability.affectedVersions}.`,
  })
  return { suggestions, productComponent: pc }
}
