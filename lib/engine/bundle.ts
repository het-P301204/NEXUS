import type {
  AwarenessCriterion,
  Case,
  ClockEvent,
  Component,
  Decision,
  Determination,
  Evidence,
  EvidenceLink,
  EvidenceTargetType,
  EvidenceType,
  Product,
  ProductComponent,
  ReportVersion,
  Review,
  ThreatIntel,
  Vulnerability,
} from '../../types/domain.ts'
import { ms } from './time.ts'

/**
 * Everything recorded about one case. It is the single input to every
 * derived view, so the server, the browser and the what-if simulator all
 * compute the same answer from the same records.
 */
export type ReportSummary = Omit<ReportVersion, 'content'>

export interface CaseBundle {
  case: Case
  vulnerability: Vulnerability
  products: Product[]
  productComponents: ProductComponent[]
  components: Component[]
  events: ClockEvent[]
  determinations: Determination[]
  decisions: Decision[]
  evidence: Evidence[]
  evidenceLinks: EvidenceLink[]
  reports: ReportSummary[]
  reviews: Review[]
  threatIntel: ThreatIntel[]
  criteria: AwarenessCriterion[]
}

export const EXPLOITATION_EVIDENCE_TYPES: EvidenceType[] = ['EXPLOIT_EVIDENCE', 'THREAT_INTELLIGENCE', 'INCIDENT_RECORD']
export const VULNERABILITY_EVIDENCE_TYPES: EvidenceType[] = [
  'VENDOR_ADVISORY',
  'SCANNER_RESULT',
  'THREAT_INTELLIGENCE',
  'TICKET',
  'EMAIL',
]

/** The latest determination per product. Earlier ones stay on the record. */
/**
 * The latest determination per product, for the products the case covers now.
 * A product removed from the case keeps its determinations on the record, but
 * they no longer take part in the analysis.
 */
export function currentDeterminations(bundle: CaseBundle): Map<string, Determination> {
  const out = new Map<string, Determination>()
  const inCase = new Set(bundle.products.map((p) => p.id))
  const sorted = [...bundle.determinations].sort((a, b) => ms(a.recordedAt) - ms(b.recordedAt) || a.id.localeCompare(b.id))
  for (const d of sorted) if (inCase.has(d.productId)) out.set(d.productId, d)
  return out
}

export function currentDecision(bundle: CaseBundle): Decision | null {
  if (bundle.decisions.length === 0) return null
  return [...bundle.decisions].sort((a, b) => ms(a.decidedAt) - ms(b.decidedAt) || a.id.localeCompare(b.id)).at(-1)!
}

export function linkedEvidenceIds(bundle: CaseBundle, targetType: EvidenceTargetType, targetId: string): string[] {
  return bundle.evidenceLinks.filter((l) => l.targetType === targetType && l.targetId === targetId).map((l) => l.evidenceId)
}

export function evidenceById(bundle: CaseBundle): Map<string, Evidence> {
  return new Map(bundle.evidence.map((e) => [e.id, e]))
}

/** Every evidence id a determination leans on: its step answers plus direct links. */
export function determinationEvidenceIds(bundle: CaseBundle, d: Determination): string[] {
  const ids = new Set<string>(linkedEvidenceIds(bundle, 'determination', d.id))
  for (const answer of Object.values(d.answers)) for (const id of answer.evidenceIds) ids.add(id)
  return [...ids]
}

export function eventEvidenceIds(bundle: CaseBundle, e: ClockEvent): string[] {
  return [...new Set([...e.evidenceIds, ...linkedEvidenceIds(bundle, 'clock_event', e.id)])]
}

export function exploitationEvidence(bundle: CaseBundle): Evidence[] {
  const ea = bundle.events.filter((e) => e.type === 'EXPLOITATION_AWARENESS')
  const linkedToEa = new Set(ea.flatMap((e) => eventEvidenceIds(bundle, e)))
  return bundle.evidence.filter((e) => EXPLOITATION_EVIDENCE_TYPES.includes(e.type) || linkedToEa.has(e.id))
}
