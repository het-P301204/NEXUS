import type { Iso, Organization } from '../../types/domain.ts'
import type { AffectednessEvaluation } from './affectedness.ts'
import type { CaseBundle } from './bundle.ts'
import { determinationEvidenceIds } from './bundle.ts'
import type { CaseAnalysis } from './analyze.ts'

/**
 * VEX-style output, shaped after OpenVEX v0.2.0.
 *
 * "VEX-style" on purpose: the document follows the OpenVEX structure and
 * status vocabulary, but NEXUS does not validate it against the schema
 * or sign it. It exists so a determination can leave NEXUS in a form
 * other tools understand.
 */

export interface VexStatement {
  vulnerability: { name: string; description: string }
  products: Array<{ '@id': string; identifiers: { purl: string }; subcomponents: Array<{ '@id': string }> }>
  status: string
  justification?: string
  impact_statement?: string
  action_statement?: string
  status_notes?: string
  timestamp: Iso
  'x-nexus': {
    /** The NEXUS product id the statement is about. */
    product: string
    /** null when the product has no determination yet. */
    determination: string | null
    analyst: string
    confidence: string
    evidence: string[]
  }
}

export interface VexDocument {
  '@context': string
  '@id': string
  author: string
  role: string
  timestamp: Iso
  version: number
  tooling: string
  statements: VexStatement[]
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function buildVex(
  bundle: CaseBundle,
  analysis: CaseAnalysis,
  org: Organization,
  userName: (id: string) => string,
  now: Iso,
): VexDocument {
  const vuln = bundle.vulnerability
  const component = bundle.components.find((c) => c.id === vuln.componentId)
  const statements: VexStatement[] = []
  for (const product of bundle.products) {
    const d = analysis.determinations[product.id]
    const purl = `pkg:generic/${slug(org.name)}/${slug(product.name)}@${product.version}`
    if (!d) {
      // A product in the case with no determination is under investigation, and
      // the export says so rather than leaving it out.
      statements.push({
        vulnerability: { name: vuln.cve ?? vuln.id, description: vuln.title },
        products: [{ '@id': purl, identifiers: { purl }, subcomponents: component ? [{ '@id': component.purl }] : [] }],
        status: 'under_investigation',
        status_notes: 'No affectedness determination has been recorded for this product yet.',
        timestamp: now,
        'x-nexus': { product: product.id, determination: null, analyst: '--', confidence: '--', evidence: [] },
      })
      continue
    }
    const evaluation: AffectednessEvaluation | undefined = analysis.evaluations[product.id]
    const pc = bundle.productComponents.find((x) => x.id === d.productComponentId)
    const statement: VexStatement = {
      vulnerability: { name: vuln.cve ?? vuln.id, description: vuln.title },
      products: [
        {
          '@id': purl,
          identifiers: { purl },
          subcomponents: component ? [{ '@id': pc ? component.purl.replace(/@.*$/, '') + `@${pc.version}` : component.purl }] : [],
        },
      ],
      status: d.vexStatus,
      timestamp: d.recordedAt,
      'x-nexus': {
        product: product.id,
        determination: d.id,
        analyst: userName(d.analystId),
        confidence: d.confidence,
        evidence: determinationEvidenceIds(bundle, d),
      },
    }
    if (d.vexStatus === 'not_affected' && d.vexJustification) {
      statement.justification = d.vexJustification
      statement.impact_statement = d.rationale
    }
    if (d.vexStatus === 'affected') {
      statement.action_statement =
        evaluation?.actionStatement ??
        (vuln.fixedVersion ? `Update ${component?.name ?? 'the component'} to ${vuln.fixedVersion} or later.` : 'Corrective measure in preparation.')
    }
    if (d.vexStatus === 'under_investigation') {
      statement.status_notes = evaluation?.reasons.join(' ') ?? d.unresolved
    }
    statements.push(statement)
  }
  return {
    '@context': 'https://openvex.dev/ns/v0.2.0',
    '@id': `urn:nexus:${slug(org.name)}:vex:${bundle.case.id}`,
    author: org.name,
    role: 'Manufacturer PSIRT',
    timestamp: now,
    version: bundle.determinations.length,
    tooling: 'NEXUS (VEX-style export, not schema-validated)',
    statements,
  }
}
