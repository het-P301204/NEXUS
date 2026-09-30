import type { ClockEvent, Evidence, ReportKind, ReportTransition, ReportVersion, Review, RoleId, SubmissionStage, User } from '../types/domain.ts'
import { APPROVAL_POLICY } from '../lib/rbac.ts'
import { canonicalJson } from '../lib/engine/ledger.ts'
import { REPORT_KIND_LABELS, buildReportContent, nextVersion } from '../lib/engine/report.ts'
import type { CaseBundle } from '../lib/engine/bundle.ts'
import { currentDecision } from '../lib/engine/bundle.ts'
import { RULE_SET } from '../rules/cra-article14.ts'
import type { Deps } from './context.ts'
import { nowIso } from './context.ts'
import { nextId } from './db.ts'
import { conflict } from './errors.ts'
import { appendAudit, readLedger } from './ledger.ts'
import { randomToken, recordHash, sha256Hex } from './hash.ts'
import { storeObject } from './evidence-store.ts'
import {
  getOrg,
  getReportRow,
  insertEvent,
  insertEvidence,
  insertLink,
  insertReport,
  insertReview,
  insertTransition,
  listReports,
  listUsers,
  loadBundle,
  reportWithStage,
  summarize,
  transitionsFor,
} from './repo.ts'
import { analyze, notify } from './services.ts'

/**
 * Report versions are immutable snapshots. Generating a report never
 * replaces an earlier version: it adds the next one, with the case state,
 * rule-set version and evidence state it was generated from.
 */

export function evidenceStateHash(bundle: CaseBundle): string {
  const state = [...bundle.evidence].map((e) => `${e.id}:${e.sha256}`).sort().join('\n')
  return sha256Hex(state)
}

export function generateReport(deps: Deps, user: User, bundle: CaseBundle, kind: ReportKind): ReportVersion {
  const now = nowIso(deps)
  const analysis = analyze(deps, bundle)
  const existing = listReports(deps.db, bundle.case.id).map(summarize)
  const { major, minor } = nextVersion(existing, kind, analysis, (r) => r.decisionId)
  const content = buildReportContent({
    kind,
    bundle,
    analysis,
    org: getOrg(deps.db),
    users: listUsers(deps.db),
    auditRefs: readLedger(deps.db, { caseId: bundle.case.id }),
    now,
  })
  const row: Omit<ReportVersion, 'stage' | 'submissionReference'> = {
    id: nextId(deps.db, 'RPT'),
    caseId: bundle.case.id,
    kind,
    major,
    minor,
    title: `${REPORT_KIND_LABELS[kind]} v${major}.${minor}`,
    generatedBy: user.id,
    generatedAt: now,
    caseStatus: analysis.status,
    decisionId: analysis.decision?.id ?? null,
    ruleSetVersion: RULE_SET.version,
    evidenceCount: bundle.evidence.length,
    evidenceStateHash: evidenceStateHash(bundle),
    contentHash: sha256Hex(canonicalJson(content)),
    content,
  }
  insertReport(deps.db, row)
  appendAudit(deps.db, {
    actorId: user.id,
    actorRole: user.role,
    eventType: 'REPORT_GENERATED',
    objectType: 'report',
    objectId: row.id,
    caseId: bundle.case.id,
    source: 'ui',
    summary: `${row.title} generated for ${bundle.case.id}`,
    payload: { reportId: row.id, kind, version: `${major}.${minor}`, contentHash: row.contentHash, evidenceStateHash: row.evidenceStateHash },
    at: now,
  })
  return reportWithStage(deps.db, row)
}

export function recordTransition(
  deps: Deps,
  actor: { id: string; role: RoleId | 'system' },
  report: ReportVersion,
  to: SubmissionStage,
  note: string,
): ReportTransition {
  const at = nowIso(deps)
  const t: ReportTransition = {
    id: nextId(deps.db, 'TRN', 5),
    reportId: report.id,
    from: report.stage,
    to,
    actorId: actor.id,
    at,
    note,
  }
  insertTransition(deps.db, t)
  appendAudit(deps.db, {
    actorId: actor.id,
    actorRole: actor.role,
    eventType: 'REPORT_STAGE_CHANGED',
    objectType: 'report',
    objectId: report.id,
    caseId: report.caseId,
    source: actor.role === 'system' ? 'system' : 'ui',
    summary: `${report.title}: ${report.stage.replace(/_/g, ' ')} -> ${to.replace(/_/g, ' ')}`,
    payload: { reportId: report.id, from: report.stage, to, note },
    at,
  })
  return t
}

const SUBMISSION_EVENT = {
  EARLY_WARNING: 'EARLY_WARNING_SUBMITTED',
  VULNERABILITY_NOTIFICATION: 'NOTIFICATION_SUBMITTED',
  FINAL_REPORT: 'FINAL_REPORT_SUBMITTED',
} as const

/**
 * SIMULATED submission. Nothing is transmitted. The receipt is stored as
 * evidence and a server-witnessed clock event records the submission time;
 * both are what the deadline engine and the completeness checklist read.
 * Caller runs this inside a transaction and records the stage transition.
 */
export function recordSubmission(
  deps: Deps,
  user: User,
  report: ReportVersion,
): { eventId: string; receiptId: string; reference: string } {
  const bundle = loadBundle(deps.db, report.caseId)!
  const decision = currentDecision(bundle)
  if (!decision || decision.outcome !== 'REPORT') {
    throw conflict('SUBMISSION_BLOCKED', 'No decision to report', 'Submission requires a recorded decision to report. Record the decision first.', {
      label: 'Open Determination',
      href: `/cases/${report.caseId}?tab=determination`,
    })
  }
  if (report.kind === 'DECISION_RECORD') {
    throw conflict('TRANSITION_NOT_ALLOWED', 'Internal record', 'A decision record is filed internally once approved. It is not submitted.')
  }
  const eventType = SUBMISSION_EVENT[report.kind]
  if (bundle.events.some((e) => e.type === eventType)) {
    throw conflict('ALREADY_SUBMITTED', 'Already submitted', `A ${report.kind.replace(/_/g, ' ').toLowerCase()} has already been submitted for this case.`)
  }
  if (report.kind === 'FINAL_REPORT' && !bundle.events.some((e) => e.type === 'MEASURE_AVAILABLE')) {
    throw conflict('SUBMISSION_BLOCKED', 'No corrective measure recorded', 'The final report follows a corrective or mitigating measure being available. Record that event first.')
  }
  const now = nowIso(deps)
  const reference = `SIM-ENISA-SRP-${randomToken(6).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`
  const receiptText = JSON.stringify(
    {
      simulated: true,
      notice: 'SIMULATED SUBMISSION -- nothing was transmitted to ENISA or any CSIRT.',
      reference,
      reportId: report.id,
      reportTitle: report.title,
      reportContentHash: report.contentHash,
      kind: report.kind,
      submittedAt: now,
      submittedBy: user.id,
      recipients: ['ENISA single reporting platform (simulated)', `${getOrg(deps.db).csirtCoordinator} (simulated)`],
    },
    null,
    2,
  )
  const bytes = new TextEncoder().encode(receiptText)
  const sha = sha256Hex(bytes)
  storeObject(deps.config.evidenceDir, sha, bytes)
  const receipt: Evidence = {
    id: nextId(deps.db, 'EV'),
    caseId: report.caseId,
    type: 'SUBMISSION_RECEIPT',
    title: `Simulated submission receipt ${reference}`,
    description: `Receipt for ${report.title}. Simulated: no data left NEXUS.`,
    source: 'NEXUS submission simulator',
    sourceCreatedAt: now,
    uploadedAt: now,
    ownerId: user.id,
    classification: 'internal',
    sha256: sha,
    fileName: `${reference}.json`,
    mimeType: 'application/json',
    sizeBytes: bytes.length,
    hasFile: true,
  }
  insertEvidence(deps.db, receipt)
  const base: Omit<ClockEvent, 'integrityHash'> = {
    id: nextId(deps.db, 'CE'),
    caseId: report.caseId,
    type: eventType,
    occurredAt: now,
    timezone: 'UTC',
    actorId: user.id,
    source: 'NEXUS server clock (simulated submission)',
    sourceKind: 'nexus_server',
    evidenceIds: [receipt.id],
    criterionId: null,
    responsibleRole: null,
    supersedesId: null,
    correctionReason: null,
    decisionId: decision.id,
    reportId: report.id,
    note: `Simulated submission ${reference}`,
    recordedAt: now,
  }
  const event: ClockEvent = { ...base, integrityHash: recordHash(base) }
  insertEvent(deps.db, event)
  insertLink(deps.db, { evidenceId: receipt.id, targetType: 'clock_event', targetId: event.id }, now, user.id)
  insertLink(deps.db, { evidenceId: receipt.id, targetType: 'report', targetId: report.id }, now, user.id)
  appendAudit(deps.db, {
    actorId: user.id,
    actorRole: user.role,
    eventType: 'SUBMISSION_RECORDED',
    objectType: 'clock_event',
    objectId: event.id,
    caseId: report.caseId,
    source: 'ui',
    summary: `${report.title} submitted (simulated) -- ${reference}`,
    payload: { eventId: event.id, reportId: report.id, receiptEvidenceId: receipt.id, receiptSha256: sha, reference, simulated: true },
    at: now,
  })
  return { eventId: event.id, receiptId: receipt.id, reference }
}

/**
 * Record a review and apply its consequence: an approval that satisfies the
 * policy advances the report to APPROVED; a rejection or change request
 * returns it to DRAFT. Separation-of-duties checks happen before this.
 */
export function applyReview(deps: Deps, user: User, review: Review, report: ReportVersion | null): string | null {
  insertReview(deps.db, review)
  appendAudit(deps.db, {
    actorId: user.id,
    actorRole: user.role,
    eventType: 'REVIEW_RECORDED',
    objectType: review.targetType,
    objectId: review.targetId,
    caseId: review.caseId,
    source: 'ui',
    summary: `${review.id}: ${review.action.replace(/_/g, ' ').toLowerCase()} on ${review.targetId} by ${user.name}`,
    payload: { reviewId: review.id, action: review.action, targetType: review.targetType, targetId: review.targetId, role: user.role },
    at: review.createdAt,
  })
  if (!report || review.action === 'COMMENT') return null
  const theCase = loadBundle(deps.db, report.caseId)!.case
  if (review.action === 'APPROVE') {
    const reviews = loadBundle(deps.db, report.caseId)!.reviews
    const state = approvalState(deps, report, reviews, transitionsFor(deps.db, report.id))
    if (!state.satisfied) return null
    recordTransition(deps, { id: 'system', role: 'system' }, report, 'APPROVED', `Approval policy satisfied: ${state.policy}`)
    notify(deps, {
      userIds: [report.generatedBy, theCase.ownerId],
      kind: 'report_approved',
      severity: 'info',
      title: `${report.title} approved -- ${theCase.id}`,
      body: state.approvals.map((a) => a.role.replace(/_/g, ' ')).join(', '),
      caseId: theCase.id,
      link: `/reports/${report.id}`,
    })
    return 'APPROVED'
  }
  recordTransition(deps, { id: user.id, role: user.role }, report, 'DRAFT', `${review.action === 'REJECT' ? 'Rejected' : 'Changes requested'}: ${review.comment}`)
  notify(deps, {
    userIds: [report.generatedBy],
    exclude: user.id,
    kind: 'report_returned',
    severity: 'watch',
    title: `${report.title} ${review.action === 'REJECT' ? 'rejected' : 'returned for changes'} -- ${theCase.id}`,
    body: review.comment,
    caseId: theCase.id,
    link: `/reports/${report.id}`,
  })
  return 'DRAFT'
}

export function currentReport(deps: Deps, id: string): ReportVersion | null {
  const row = getReportRow(deps.db, id)
  return row ? reportWithStage(deps.db, row) : null
}

/**
 * Approval policy check. Approvals count only from reviewers who neither
 * generated the report nor recorded the decision it reports, and only
 * approvals recorded since the report last entered INTERNAL_REVIEW.
 */
export function approvalState(
  deps: Deps,
  report: ReportVersion,
  reviews: Review[],
  transitions: ReportTransition[],
): { policy: string; satisfied: boolean; approvals: Array<{ reviewerId: string; role: RoleId; at: string }> } {
  const policy = APPROVAL_POLICY[report.kind]!
  const enteredReview = [...transitions].reverse().find((t) => t.to === 'INTERNAL_REVIEW')
  const bundle = loadBundle(deps.db, report.caseId)
  const decisionAnalyst = bundle?.decisions.find((d) => d.id === report.decisionId)?.analystId ?? null
  const approvals = reviews
    .filter(
      (r) =>
        r.targetType === 'report' &&
        r.targetId === report.id &&
        r.action === 'APPROVE' &&
        (!enteredReview || r.createdAt >= enteredReview.at) &&
        r.reviewerId !== report.generatedBy &&
        r.reviewerId !== decisionAnalyst,
    )
    .map((r) => ({ reviewerId: r.reviewerId, role: r.reviewerRole, at: r.createdAt }))
  const roles = new Set(approvals.map((a) => a.role))
  const satisfied = policy.anyOf.some((set) => set.every((r) => roles.has(r)))
  return { policy: policy.label, satisfied, approvals }
}
