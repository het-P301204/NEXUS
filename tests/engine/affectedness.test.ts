import { describe, expect, it } from 'vitest'
import { evaluateAffectedness, suggestFromSbom } from '../../lib/engine/affectedness.ts'
import { compareVersions, inRange } from '../../lib/engine/versions.ts'
import { PRODUCT, VULN, answers } from '../helpers.ts'

const exposed = { component_present: 'YES', vulnerable_version: 'YES', functionality_enabled: 'YES', feature_reachable: 'YES', exploit_path: 'YES' } as const

describe('affectedness engine', () => {
  it('never reduces affectedness to "component found": presence alone is under investigation', () => {
    expect(evaluateAffectedness(answers({ component_present: 'YES' })).result).toBe('UNDER_INVESTIGATION')
  })

  it('returns UNDER INVESTIGATION for an UNKNOWN answer, never NOT AFFECTED', () => {
    const r = evaluateAffectedness(answers({ component_present: 'YES', vulnerable_version: 'UNKNOWN', functionality_enabled: 'NO', product_validation: 'YES' }))
    expect(r.result).toBe('UNDER_INVESTIGATION')
    expect(r.decidingStep).toBe('vulnerable_version')
  })

  it('is AFFECTED when exposed and not mitigated by configuration', () => {
    const r = evaluateAffectedness(answers({ ...exposed, configuration_mitigates: 'NO' }))
    expect(r.result).toBe('AFFECTED')
    expect(r.vexStatus).toBe('affected')
  })

  it('stays UNDER INVESTIGATION when exposure is established but mitigation is unknown', () => {
    expect(evaluateAffectedness(answers({ ...exposed, configuration_mitigates: 'UNKNOWN' })).result).toBe('UNDER_INVESTIGATION')
  })

  it('records NOT AFFECTED only with product-specific validation', () => {
    const noValidation = evaluateAffectedness(answers({ component_present: 'YES', vulnerable_version: 'YES', functionality_enabled: ['NO', ['EV-1']] }))
    expect(noValidation.result).toBe('UNDER_INVESTIGATION')
    expect(noValidation.decidingStep).toBe('product_validation')
    const validated = evaluateAffectedness(answers({ component_present: 'YES', vulnerable_version: 'YES', functionality_enabled: ['NO', ['EV-1']], product_validation: 'YES' }))
    expect(validated.result).toBe('NOT_AFFECTED')
    expect(validated.justification).toBe('vulnerable_code_not_present')
  })

  it('records NOT AFFECTED only when the deciding answer has evidence', () => {
    const r = evaluateAffectedness(answers({ component_present: 'YES', vulnerable_version: 'YES', functionality_enabled: 'YES', feature_reachable: 'NO', product_validation: 'YES' }))
    expect(r.result).toBe('UNDER_INVESTIGATION')
    expect(r.missingEvidence).toContain('feature_reachable')
  })

  it('maps each exit to its VEX justification', () => {
    const cases = [
      [{ component_present: ['NO', ['E']] }, 'component_not_present'],
      [{ component_present: 'YES', vulnerable_version: ['NO', ['E']] }, 'vulnerable_code_not_present'],
      [{ component_present: 'YES', vulnerable_version: 'YES', functionality_enabled: 'YES', feature_reachable: ['NO', ['E']] }, 'vulnerable_code_not_in_execute_path'],
      [{ ...exposed, exploit_path: ['NO', ['E']] }, 'vulnerable_code_cannot_be_controlled_by_adversary'],
      [{ ...exposed, configuration_mitigates: ['YES', ['E']] }, 'inline_mitigations_already_exist'],
    ] as const
    for (const [spec, justification] of cases) {
      const r = evaluateAffectedness(answers({ ...spec, product_validation: 'YES' } as unknown as Parameters<typeof answers>[0]))
      expect(r.result, justification).toBe('NOT_AFFECTED')
      expect(r.justification).toBe(justification)
    }
  })

  it('does not let a compensating control change affectedness; it becomes an action statement', () => {
    const r = evaluateAffectedness(answers({ ...exposed, configuration_mitigates: 'NO', compensating_control: 'YES' }))
    expect(r.result).toBe('AFFECTED')
    expect(r.actionStatement).toMatch(/Affectedness is unchanged/)
  })

  it('decides AFFECTED when exploitation was demonstrated against the product, and flags contradictions', () => {
    const r = evaluateAffectedness(answers({ component_present: 'YES', vulnerable_version: 'YES', feature_reachable: 'NO', exploitation_demonstrated: 'YES' }))
    expect(r.result).toBe('AFFECTED')
    expect(r.contradictions).toHaveLength(1)
    expect(r.contradictions[0]).toMatch(/Step 4/)
  })

  it('stops the walk at the first deciding answer and marks later steps as not reached', () => {
    const r = evaluateAffectedness(answers({ component_present: ['NO', ['E']], vulnerable_version: 'YES', product_validation: 'YES' }))
    expect(r.path[1]!.effect).toBe('not_reached')
  })
})

describe('SBOM suggestions', () => {
  const components = [{ id: 'CMP-T', name: 'testlib', purl: 'pkg:generic/testlib', ecosystem: 'C', supplier: 'x' }]
  it('suggests presence and range from a current SBOM', () => {
    const s = suggestFromSbom(VULN, PRODUCT, [{ id: 'PC', productId: PRODUCT.id, componentId: 'CMP-T', version: '1.5.0', relation: 'direct', viaId: null, usage: '' }], components)
    expect(s.suggestions.map((x) => [x.step, x.answer])).toEqual([
      ['component_present', 'YES'],
      ['vulnerable_version', 'YES'],
    ])
  })
  it('does not infer absence from a stale or missing SBOM', () => {
    expect(suggestFromSbom(VULN, { ...PRODUCT, sbomStatus: 'stale' }, [], components).suggestions[0]!.answer).toBe('UNKNOWN')
    expect(suggestFromSbom(VULN, { ...PRODUCT, sbomStatus: 'missing' }, [], components).suggestions[0]!.answer).toBe('UNKNOWN')
    expect(suggestFromSbom(VULN, PRODUCT, [], components).suggestions[0]!.answer).toBe('NO')
  })
})

describe('version ranges', () => {
  it('compares dotted versions with letter suffixes', () => {
    expect(compareVersions('1.1.1w', '1.1.1')).toBe(1)
    expect(compareVersions('3.0', '3.0.0')).toBe(0)
    expect(compareVersions('2.9.14', '2.12.0')).toBe(-1)
    expect(compareVersions('2022.83', '2024.85')).toBe(-1)
  })
  it('evaluates ranges with alternatives', () => {
    expect(inRange('3.0.9', '>=3.0.0 <3.0.16 || >=3.1.0 <3.1.8')).toBe(true)
    expect(inRange('3.1.9', '>=3.0.0 <3.0.16 || >=3.1.0 <3.1.8')).toBe(false)
    expect(inRange('1.36.1', '<1.36.2')).toBe(true)
  })
  it('returns null for an unreadable version or range, so the engine reads UNKNOWN', () => {
    expect(inRange('latest', '<2.0')).toBeNull()
    expect(inRange('1.0', '~> 2.0')).toBeNull()
  })
})
