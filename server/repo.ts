import type {
  AwarenessCriterion,
  Case,
  CaseRelation,
  ClockEvent,
  Comment,
  Component,
  Decision,
  Deployment,
  Determination,
  EscalationRule,
  Evidence,
  EvidenceLink,
  Notification,
  Organization,
  Product,
  ProductComponent,
  ReportTransition,
  ReportVersion,
  Review,
  SubmissionStage,
  ThreatIntel,
  User,
  Vulnerability,
} from '../types/domain.ts'
import type { CaseBundle, ReportSummary } from '../lib/engine/bundle.ts'
import type { Db } from './db.ts'
import { all, getOne } from './db.ts'

/**
 * Data access. Reads return domain objects; writes take them. No business
 * rule lives here -- validation and authorisation happen before a write
 * reaches this file, and history tables reject edits on their own.
 */

// Reads ---------------------------------------------------------------------

export const getOrg = (db: Db) => all<Organization>(db, 'organization')[0]!
export const listUsers = (db: Db) => all<User>(db, 'users', 'ORDER BY id')
export const getUser = (db: Db, id: string) => getOne<User>(db, 'users', id)
export const listProducts = (db: Db) => all<Product>(db, 'products', 'ORDER BY id')
export const getProduct = (db: Db, id: string) => getOne<Product>(db, 'products', id)
export const listComponents = (db: Db) => all<Component>(db, 'components', 'ORDER BY id')
export const listProductComponents = (db: Db) => all<ProductComponent>(db, 'product_components', 'ORDER BY id')
export const listDeployments = (db: Db) => all<Deployment>(db, 'deployments', 'ORDER BY id')
export const listVulnerabilities = (db: Db) => all<Vulnerability>(db, 'vulnerabilities', 'ORDER BY id')
export const getVulnerability = (db: Db, id: string) => getOne<Vulnerability>(db, 'vulnerabilities', id)
export const listThreatIntel = (db: Db, vulnerabilityId?: string) =>
  vulnerabilityId
    ? all<ThreatIntel>(db, 'threat_intel', 'WHERE vulnerability_id = ? ORDER BY id', vulnerabilityId)
    : all<ThreatIntel>(db, 'threat_intel', 'ORDER BY id')
export const listCases = (db: Db) => all<Case>(db, 'cases', 'ORDER BY created_at DESC')
export const getCase = (db: Db, id: string) => getOne<Case>(db, 'cases', id)
export const listCriteria = (db: Db) => all<AwarenessCriterion>(db, 'criteria', 'ORDER BY id')
export const listEscalation = (db: Db) => all<EscalationRule>(db, 'escalation_rules', 'ORDER BY id')
export const getEvidence = (db: Db, id: string) => getOne<Evidence>(db, 'evidence', id)
export const listEvidence = (db: Db) => all<Evidence>(db, 'evidence', 'ORDER BY id')
export const listComments = (db: Db, caseId: string) => all<Comment>(db, 'comments', 'WHERE case_id = ? ORDER BY id', caseId)
export const listRelations = (db: Db, caseId: string) =>
  all<CaseRelation>(db, 'case_relations', 'WHERE case_id = ? OR related_case_id = ? ORDER BY id', caseId, caseId)
export const getReportRow = (db: Db, id: string) => getOne<Omit<ReportVersion, 'stage' | 'submissionReference'>>(db, 'reports', id)

export function listLinks(db: Db, evidenceIds?: string[]): EvidenceLink[] {
  const rows = db.prepare('SELECT evidence_id, target_type, target_id FROM evidence_links ORDER BY created_at').all() as Array<{
    evidence_id: string
    target_type: EvidenceLink['targetType']
    target_id: string
  }>
  const set = evidenceIds ? new Set(evidenceIds) : null
  return rows
    .filter((r) => !set || set.has(r.evidence_id))
    .map((r) => ({ evidenceId: r.evidence_id, targetType: r.target_type, targetId: r.target_id }))
}

export function transitionsFor(db: Db, reportId: string): ReportTransition[] {
  return all<ReportTransition>(db, 'report_transitions', 'WHERE report_id = ? ORDER BY at, id', reportId)
}

/** A report's stage is derived from its transitions; the version row itself never changes. */
export function reportWithStage(db: Db, row: Omit<ReportVersion, 'stage' | 'submissionReference'>): ReportVersion {
  const transitions = transitionsFor(db, row.id)
  const last = transitions.at(-1)
  const submitted = transitions.find((t) => t.to === 'SUBMITTED')
  const ref = submitted ? (/SIM-[A-Z0-9-]+/.exec(submitted.note)?.[0] ?? null) : null
  return { ...row, stage: (last?.to ?? 'DRAFT') as SubmissionStage, submissionReference: ref }
}

export function listReports(db: Db, caseId?: string): ReportVersion[] {
  const rows = caseId
    ? all<Omit<ReportVersion, 'stage' | 'submissionReference'>>(db, 'reports', 'WHERE case_id = ? ORDER BY id', caseId)
    : all<Omit<ReportVersion, 'stage' | 'submissionReference'>>(db, 'reports', 'ORDER BY id')
  return rows.map((r) => reportWithStage(db, r))
}

export function summarize(r: ReportVersion): ReportSummary {
  const { content: _c, ...rest } = r
  return rest
}

export function loadBundle(db: Db, caseId: string): CaseBundle | null {
  const c = getCase(db, caseId)
  if (!c) return null
  const vulnerability = getVulnerability(db, c.vulnerabilityId)!
  const products = c.productIds.map((id) => getProduct(db, id)).filter((p): p is Product => !!p)
  const productIds = new Set(products.map((p) => p.id))
  const productComponents = listProductComponents(db).filter((pc) => productIds.has(pc.productId))
  const componentIds = new Set([...productComponents.map((pc) => pc.componentId), vulnerability.componentId].filter(Boolean))
  const components = listComponents(db).filter((x) => componentIds.has(x.id))
  const evidence = all<Evidence>(db, 'evidence', 'WHERE case_id = ? ORDER BY id', caseId)
  return {
    case: c,
    vulnerability,
    products,
    productComponents,
    components,
    events: all<ClockEvent>(db, 'clock_events', 'WHERE case_id = ? ORDER BY recorded_at, id', caseId),
    determinations: all<Determination>(db, 'determinations', 'WHERE case_id = ? ORDER BY recorded_at, id', caseId),
    decisions: all<Decision>(db, 'decisions', 'WHERE case_id = ? ORDER BY decided_at, id', caseId),
    evidence,
    evidenceLinks: listLinks(db, evidence.map((e) => e.id)),
    reports: listReports(db, caseId).map(summarize),
    reviews: all<Review>(db, 'reviews', 'WHERE case_id = ? ORDER BY id', caseId),
    threatIntel: listThreatIntel(db, vulnerability.id),
    criteria: listCriteria(db),
  }
}

export function listNotifications(db: Db, userId: string): Notification[] {
  // read_at lives in its own column: marking read is the one update a
  // notification ever receives.
  const rows = db
    .prepare('SELECT data, read_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100')
    .all(userId) as Array<{ data: string; read_at: string | null }>
  return rows.map((r) => ({ ...(JSON.parse(r.data) as Notification), readAt: r.read_at }))
}

// Writes --------------------------------------------------------------------

export function insertJson(db: Db, table: string, columns: Record<string, string | number | null>, data: unknown): void {
  const cols = Object.keys(columns)
  const sql = `INSERT INTO ${table}(${[...cols, 'data'].join(', ')}) VALUES (${[...cols, 'data'].map(() => '?').join(', ')})`
  db.prepare(sql).run(...Object.values(columns), JSON.stringify(data))
}

export function updateJson(db: Db, table: string, id: string, data: unknown, extra: Record<string, string | number | null> = {}): void {
  const sets = [...Object.keys(extra).map((k) => `${k} = ?`), 'data = ?']
  db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`).run(...Object.values(extra), JSON.stringify(data), id)
}

export function insertCase(db: Db, c: Case): void {
  insertJson(db, 'cases', { id: c.id, vulnerability_id: c.vulnerabilityId, owner_id: c.ownerId, lifecycle: c.lifecycle, created_at: c.createdAt }, c)
}

export function updateCase(db: Db, c: Case): void {
  updateJson(db, 'cases', c.id, c, { owner_id: c.ownerId, lifecycle: c.lifecycle })
}

export function insertEvent(db: Db, e: ClockEvent): void {
  insertJson(db, 'clock_events', { id: e.id, case_id: e.caseId, type: e.type, recorded_at: e.recordedAt }, e)
}

export function insertDetermination(db: Db, d: Determination): void {
  insertJson(db, 'determinations', { id: d.id, case_id: d.caseId, product_id: d.productId, recorded_at: d.recordedAt }, d)
}

export function insertDecision(db: Db, d: Decision): void {
  insertJson(db, 'decisions', { id: d.id, case_id: d.caseId, decided_at: d.decidedAt }, d)
}

export function insertEvidence(db: Db, e: Evidence): void {
  insertJson(db, 'evidence', { id: e.id, case_id: e.caseId, sha256: e.sha256 }, e)
}

export function insertLink(db: Db, link: EvidenceLink, at: string, by: string): boolean {
  const res = db
    .prepare('INSERT OR IGNORE INTO evidence_links(evidence_id, target_type, target_id, created_at, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(link.evidenceId, link.targetType, link.targetId, at, by)
  return Number(res.changes) > 0
}

export function insertReport(db: Db, r: Omit<ReportVersion, 'stage' | 'submissionReference'>): void {
  insertJson(db, 'reports', { id: r.id, case_id: r.caseId, kind: r.kind }, r)
}

export function insertTransition(db: Db, t: ReportTransition): void {
  insertJson(db, 'report_transitions', { id: t.id, report_id: t.reportId, at: t.at }, t)
}

export function insertReview(db: Db, r: Review): void {
  insertJson(db, 'reviews', { id: r.id, case_id: r.caseId, target_type: r.targetType, target_id: r.targetId }, r)
}

export function insertComment(db: Db, c: Comment): void {
  insertJson(db, 'comments', { id: c.id, case_id: c.caseId }, c)
}

export function insertNotification(db: Db, n: Notification): void {
  insertJson(db, 'notifications', { id: n.id, user_id: n.userId, created_at: n.createdAt, read_at: n.readAt }, n)
}

export function insertRelation(db: Db, r: CaseRelation): void {
  insertJson(db, 'case_relations', { id: r.id, case_id: r.caseId, related_case_id: r.relatedCaseId }, r)
}

export function insertThreatIntel(db: Db, t: ThreatIntel): void {
  insertJson(db, 'threat_intel', { id: t.id, vulnerability_id: t.vulnerabilityId }, t)
}

export function insertVulnerability(db: Db, v: Vulnerability): void {
  insertJson(db, 'vulnerabilities', { id: v.id, cve: v.cve, component_id: v.componentId }, v)
}

export function updateVulnerability(db: Db, v: Vulnerability): void {
  updateJson(db, 'vulnerabilities', v.id, v, { cve: v.cve, component_id: v.componentId })
}

export function insertProduct(db: Db, p: Product): void {
  insertJson(db, 'products', { id: p.id }, p)
}

export function insertComponent(db: Db, c: Component): void {
  insertJson(db, 'components', { id: c.id, purl: c.purl }, c)
}

export function insertProductComponent(db: Db, pc: ProductComponent): void {
  insertJson(db, 'product_components', { id: pc.id, product_id: pc.productId, component_id: pc.componentId }, pc)
}

export function insertDeployment(db: Db, d: Deployment): void {
  insertJson(db, 'deployments', { id: d.id, product_id: d.productId }, d)
}
