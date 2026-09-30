import type { Notification, NotificationSeverity, RoleId, User } from '../types/domain.ts'
import type { CaseListItem, ChangeItem } from '../types/api.ts'
import type { CaseAnalysis } from '../lib/engine/analyze.ts'
import { analyzeCase } from '../lib/engine/analyze.ts'
import type { CaseBundle } from '../lib/engine/bundle.ts'
import type { Db } from './db.ts'
import { nextId } from './db.ts'
import type { Deps } from './context.ts'
import { nowIso } from './context.ts'
import { insertNotification, listCases, listUsers, loadBundle } from './repo.ts'
import { redactEvidence } from './authz.ts'

export function analyze(deps: Deps, bundle: CaseBundle): CaseAnalysis {
  return analyzeCase(bundle, nowIso(deps))
}

export function allAnalyzed(deps: Deps): Array<{ bundle: CaseBundle; analysis: CaseAnalysis }> {
  return listCases(deps.db).map((c) => {
    const bundle = loadBundle(deps.db, c.id)!
    return { bundle, analysis: analyze(deps, bundle) }
  })
}

export function lastLedgerAt(db: Db, caseId: string): string | null {
  const row = db.prepare('SELECT at FROM audit_events WHERE case_id = ? ORDER BY seq DESC LIMIT 1').get(caseId) as { at: string } | undefined
  return row?.at ?? null
}

export function toListItem(db: Db, bundle: CaseBundle, analysis: CaseAnalysis): CaseListItem {
  const next = analysis.nextDeadline
  return {
    id: bundle.case.id,
    title: bundle.case.title,
    cve: bundle.vulnerability.cve,
    vulnerabilityId: bundle.vulnerability.id,
    severity: bundle.vulnerability.severity,
    exploitation: bundle.vulnerability.exploitation,
    status: analysis.status,
    lifecycle: bundle.case.lifecycle,
    products: bundle.products.map((p) => ({ id: p.id, name: p.name, version: p.version })),
    ownerId: bundle.case.ownerId,
    tags: bundle.case.tags,
    nextDeadline:
      next && next.dueAt && next.remainingMs !== null
        ? { kind: next.kind, label: next.label, dueAt: next.dueAt, remainingMs: next.remainingMs, status: next.status }
        : null,
    deadlineStatuses: analysis.deadlines.map((d) => ({ kind: d.kind, status: d.status })),
    affectedness: analysis.suggestion.aggregateAffectedness,
    completeness: { satisfied: analysis.completeness.satisfied, applicable: analysis.completeness.applicable },
    health: analysis.health,
    qualityErrors: analysis.quality.filter((q) => q.severity === 'error').length,
    qualityWarnings: analysis.quality.filter((q) => q.severity === 'warning').length,
    createdAt: bundle.case.createdAt,
    updatedAt: lastLedgerAt(db, bundle.case.id),
  }
}

export function redactBundle(user: User, bundle: CaseBundle): CaseBundle {
  return { ...bundle, evidence: bundle.evidence.map((e) => redactEvidence(user, e)) }
}

// Notifications ----------------------------------------------------------------

export interface NotifyInput {
  userIds?: string[]
  roles?: RoleId[]
  exclude?: string
  kind: string
  severity: NotificationSeverity
  title: string
  body: string
  caseId: string | null
  link: string | null
}

export function notify(deps: Deps, input: NotifyInput): void {
  const users = listUsers(deps.db).filter((u) => u.active)
  const targets = new Set<string>(input.userIds ?? [])
  for (const u of users) if (input.roles?.includes(u.role)) targets.add(u.id)
  if (input.exclude) targets.delete(input.exclude)
  const at = nowIso(deps)
  for (const userId of targets) {
    const n: Notification = {
      id: nextId(deps.db, 'NTF', 5),
      userId,
      kind: input.kind,
      severity: input.severity,
      title: input.title,
      body: input.body,
      caseId: input.caseId,
      link: input.link,
      createdAt: at,
      readAt: null,
    }
    insertNotification(deps.db, n)
  }
}

// What changed since last review --------------------------------------------------

const CATEGORY: Record<string, ChangeItem['category']> = {
  EVIDENCE_ADDED: 'evidence',
  EVIDENCE_LINKED: 'evidence',
  CLOCK_EVENT_RECORDED: 'timestamp',
  CLOCK_EVENT_CORRECTED: 'timestamp',
  AWARENESS_ESTABLISHED: 'deadline',
  DETERMINATION_RECORDED: 'affectedness',
  DECISION_RECORDED: 'status',
  CASE_LIFECYCLE_CHANGED: 'status',
  CASE_UPDATED: 'other',
  CASE_OWNER_CHANGED: 'review',
  REVIEW_RECORDED: 'review',
  REPORT_GENERATED: 'report',
  REPORT_STAGE_CHANGED: 'report',
  SUBMISSION_RECORDED: 'deadline',
}

export function changesSince(db: Db, caseId: string, userId: string): { since: string | null; sinceSeq: number; items: ChangeItem[] } {
  const marker = db.prepare('SELECT reviewed_at, ledger_seq FROM case_review_markers WHERE user_id = ? AND case_id = ?').get(userId, caseId) as
    | { reviewed_at: string; ledger_seq: number }
    | undefined
  const sinceSeq = marker?.ledger_seq ?? 0
  const rows = db
    .prepare('SELECT seq, at, event_type, data FROM audit_events WHERE case_id = ? AND seq > ? ORDER BY seq')
    .all(caseId, sinceSeq) as Array<{ seq: number; at: string; event_type: string; data: string }>
  return {
    since: marker?.reviewed_at ?? null,
    sinceSeq,
    items: rows.map((r) => {
      const d = JSON.parse(r.data) as { summary: string; actorId: string }
      return {
        seq: r.seq,
        at: r.at,
        eventType: r.event_type,
        summary: d.summary,
        actorId: d.actorId,
        category: CATEGORY[r.event_type] ?? 'other',
      }
    }),
  }
}
