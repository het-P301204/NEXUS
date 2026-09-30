import { z } from 'zod'
import type { Hono } from 'hono'
import type { ReportContent, ReportVersion, Review, SubmissionStage } from '../../types/domain.ts'
import type { ReportDetailResponse } from '../../types/api.ts'
import { APPROVAL_POLICY, can } from '../../lib/rbac.ts'
import { DISCLAIMER } from '../../lib/engine/report.ts'
import { escapeHtml, mdCell } from '../../lib/text.ts'
import type { Deps, Env } from '../context.ts'
import { nowIso, requirePermission, requireUser } from '../context.ts'
import { nextId, tx } from '../db.ts'
import { ApiError, conflict, forbidden, invalid, notFound } from '../errors.ts'
import { assertCaseOpen, loadCaseForRead, loadCaseForWrite } from '../authz.ts'
import { currentDecision } from '../../lib/engine/bundle.ts'
import { listReports, listUsers, loadBundle, transitionsFor } from '../repo.ts'
import { applyReview, approvalState, currentReport, generateReport, recordSubmission, recordTransition } from '../reporting.ts'
import { notify } from '../services.ts'
import { id, parseBody, text } from '../validation.ts'

/**
 * The submission workflow:
 *
 *   DRAFT -> INTERNAL_REVIEW -> APPROVED -> READY -> SUBMITTED -> ACKNOWLEDGED -> CLOSED
 *
 * APPROVED is reached only by approvals that satisfy the report kind's
 * policy. SUBMITTED is simulated: nothing leaves NEXUS. The simulated
 * receipt is stored as evidence, and a server-witnessed clock event records
 * the submission time.
 */

const FORWARD: Partial<Record<SubmissionStage, SubmissionStage[]>> = {
  DRAFT: ['INTERNAL_REVIEW'],
  APPROVED: ['READY', 'CLOSED'],
  READY: ['SUBMITTED'],
  SUBMITTED: ['ACKNOWLEDGED'],
  ACKNOWLEDGED: ['CLOSED'],
}


export function reportRoutes(app: Hono<Env>, deps: Deps): void {
  const { db } = deps

  app.post('/api/cases/:id/reports', async (c) => {
    const user = requirePermission(c, 'report.generate')
    const theCase = loadCaseForWrite(db, user, c.req.param('id'))
    const { kind } = await parseBody(c, z.object({ kind: z.enum(['EARLY_WARNING', 'VULNERABILITY_NOTIFICATION', 'FINAL_REPORT', 'DECISION_RECORD']) }))
    const report = tx(db, () => generateReport(deps, user, loadBundle(db, theCase.id)!, kind))
    return c.json({ id: report.id, version: `${report.major}.${report.minor}` }, 201)
  })

  app.get('/api/reports', (c) => {
    requireUser(c)
    const reports = listReports(db).map(({ content: _c, ...rest }) => rest)
    return c.json({ reports })
  })

  app.get('/api/reports/:id', (c) => {
    requireUser(c)
    const report = currentReport(deps, c.req.param('id'))
    if (!report) throw notFound('Report', c.req.param('id'))
    const bundle = loadBundle(db, report.caseId)!
    const transitions = transitionsFor(db, report.id)
    const versions = listReports(db, report.caseId)
      .filter((r) => r.kind === report.kind)
      .map((r) => ({ id: r.id, major: r.major, minor: r.minor, generatedAt: r.generatedAt, generatedBy: r.generatedBy, stage: r.stage, caseStatus: r.caseStatus, contentHash: r.contentHash }))
    const latest = versions.at(-1)
    const body: ReportDetailResponse = {
      report,
      transitions,
      reviews: bundle.reviews.filter((r) => r.targetType === 'report' && r.targetId === report.id),
      approval: approvalState(deps, report, bundle.reviews, transitions),
      versions,
      latestOfKind: latest?.id === report.id,
    }
    return c.json(body)
  })

  app.post('/api/reports/:id/transition', async (c) => {
    const user = requireUser(c)
    const input = await parseBody(c, z.object({ to: z.enum(['INTERNAL_REVIEW', 'READY', 'SUBMITTED', 'ACKNOWLEDGED', 'CLOSED']), note: text(1000).default('') }))
    const report = currentReport(deps, c.req.param('id'))
    if (!report) throw notFound('Report', c.req.param('id'))
    requirePermission(c, input.to === 'SUBMITTED' ? 'submission.submit' : 'submission.advance')
    const theCase = loadCaseForWrite(db, user, report.caseId)
    const allowed = FORWARD[report.stage] ?? []
    if (!allowed.includes(input.to)) {
      throw conflict(
        'TRANSITION_NOT_ALLOWED',
        'Stage change not allowed',
        report.stage === 'INTERNAL_REVIEW'
          ? 'A report in internal review moves on only through reviews: approval advances it, rejection or a change request returns it to draft.'
          : `${report.title} is ${report.stage.replace(/_/g, ' ').toLowerCase()} and cannot move to ${input.to.replace(/_/g, ' ').toLowerCase()}.`,
      )
    }
    if (report.kind === 'DECISION_RECORD' && (input.to === 'READY' || input.to === 'SUBMITTED')) {
      throw conflict('TRANSITION_NOT_ALLOWED', 'Internal record', 'A decision record is filed internally once approved. It is not submitted.')
    }
    const newer = listReports(db, report.caseId).filter((r) => r.kind === report.kind && (r.major > report.major || (r.major === report.major && r.minor > report.minor)))
    if ((input.to === 'READY' || input.to === 'SUBMITTED') && newer.length > 0) {
      throw conflict('REPORT_SUPERSEDED', 'A newer version exists', `${newer.at(-1)!.title} supersedes this version. Submit the latest version.`)
    }
    if (input.to === 'READY' || input.to === 'SUBMITTED') {
      // What is submitted must carry the decision that authorises it. A version
      // generated before the decision, or under an earlier one, says something
      // the record no longer says.
      const decision = currentDecision(loadBundle(db, report.caseId)!)
      if (!decision || decision.outcome !== 'REPORT') {
        throw conflict(
          'NO_DECISION_TO_REPORT',
          'No decision to report',
          decision
            ? `The current decision (${decision.id}) is that reporting is not required. ${report.title} cannot be marked ready or submitted.`
            : 'No reportability decision is recorded. Record the decision to report, then generate a version that carries it.',
        )
      }
      if (report.decisionId !== decision.id) {
        throw conflict(
          'REPORT_DECISION_MISMATCH',
          'Report does not carry the current decision',
          `${report.title} was generated ${report.decisionId ? `under decision ${report.decisionId}` : 'before any decision was recorded'}; the current decision is ${decision.id}. Generate a new version that carries it.`,
        )
      }
    }

    let submission: { eventId: string; receiptId: string; reference: string } | null = null
    tx(db, () => {
      if (input.to === 'SUBMITTED') submission = recordSubmission(deps, user, report)
      recordTransition(
        deps,
        { id: user.id, role: user.role },
        report,
        input.to,
        submission ? `Simulated submission ${(submission as { reference: string }).reference}. ${input.note}`.trim() : input.note,
      )
      if (input.to === 'INTERNAL_REVIEW') {
        notify(deps, {
          roles: report.kind === 'DECISION_RECORD' ? ['compliance_reviewer', 'legal_reviewer'] : report.kind === 'EARLY_WARNING' ? ['psirt_lead', 'security_manager'] : ['security_manager', 'compliance_reviewer'],
          exclude: user.id,
          kind: 'review_required',
          severity: 'watch',
          title: `Review required: ${report.title} -- ${theCase.id}`,
          body: theCase.title,
          caseId: theCase.id,
          link: `/reports/${report.id}`,
        })
      }
    })
    return c.json({ ok: true, submission })
  })

  // Reviews ---------------------------------------------------------------------
  app.post('/api/cases/:id/reviews', async (c) => {
    const user = requireUser(c)
    const input = await parseBody(
      c,
      z.object({
        targetType: z.enum(['report', 'decision', 'determination']),
        targetId: id,
        action: z.enum(['APPROVE', 'REJECT', 'REQUEST_CHANGES', 'COMMENT']),
        comment: text(4000).default(''),
      }),
    )
    requirePermission(c, input.action === 'COMMENT' ? 'comment.write' : 'review.approve')
    const theCase = assertCaseOpen(loadCaseForRead(db, c.req.param('id')))
    const bundle = loadBundle(db, theCase.id)!
    if ((input.action === 'REJECT' || input.action === 'REQUEST_CHANGES') && input.comment.length < 10) {
      throw invalid('Reason required', 'Rejecting or requesting changes needs a comment explaining what to change.', { comment: 'At least 10 characters' })
    }

    let report: ReportVersion | null = null
    if (input.targetType === 'report') {
      report = currentReport(deps, input.targetId)
      if (!report || report.caseId !== theCase.id) throw notFound('Report', input.targetId)
      if (input.action !== 'COMMENT' && report.stage !== 'INTERNAL_REVIEW') {
        throw conflict('NOT_IN_REVIEW', 'Report is not in review', `${report.title} is ${report.stage.replace(/_/g, ' ').toLowerCase()}. Only a report in internal review can be approved or returned.`)
      }
      // Approving, rejecting and requesting changes belong to the roles in this
      // kind's approval policy. Anyone else with review rights can comment, but
      // cannot hold a report in draft that is not theirs to approve.
      const policy = APPROVAL_POLICY[report.kind]!
      if (input.action !== 'COMMENT' && !policy.anyOf.flat().includes(user.role)) {
        throw forbidden(`Your role is not part of the approval policy for this report. ${policy.label} You can comment instead.`)
      }
      // Nobody approves a report they generated, the decision it carries, or the
      // decision now in force (a version generated before it may be regenerated
      // under it).
      const decisionAnalyst = bundle.decisions.find((d) => d.id === report!.decisionId)?.analystId
      const currentAnalyst = currentDecision(bundle)?.analystId
      if (input.action !== 'COMMENT' && (report.generatedBy === user.id || decisionAnalyst === user.id || currentAnalyst === user.id)) {
        throw new ApiError(
          403,
          'SEPARATION_OF_DUTIES',
          'Separation of duties',
          report.generatedBy === user.id
            ? 'You generated this report version. Approval must come from someone else.'
            : 'You recorded the decision behind this report. Approval must come from someone else.',
        )
      }
    } else if (input.targetType === 'decision') {
      const d = bundle.decisions.find((x) => x.id === input.targetId)
      if (!d) throw notFound('Decision', input.targetId)
      if (input.action !== 'COMMENT' && d.analystId === user.id) throw new ApiError(403, 'SEPARATION_OF_DUTIES', 'Separation of duties', 'You recorded this decision. It must be reviewed by someone else.')
    } else {
      const d = bundle.determinations.find((x) => x.id === input.targetId)
      if (!d) throw notFound('Determination', input.targetId)
      if (input.action !== 'COMMENT' && d.analystId === user.id) throw new ApiError(403, 'SEPARATION_OF_DUTIES', 'Separation of duties', 'You recorded this determination. It must be reviewed by someone else.')
    }
    if (input.action === 'APPROVE' && !can(user.role, 'review.approve')) throw forbidden('Approval requires the review.approve permission.')

    const review: Review = {
      id: nextId(db, 'REV'),
      caseId: theCase.id,
      targetType: input.targetType,
      targetId: input.targetId,
      reviewerId: user.id,
      reviewerRole: user.role,
      action: input.action,
      comment: input.comment,
      createdAt: nowIso(deps),
    }
    const advanced = tx(db, () => applyReview(deps, user, review, report))
    return c.json({ id: review.id, advanced }, 201)
  })

  // Exports ---------------------------------------------------------------------
  app.get('/api/reports/:id/export', (c) => {
    requireUser(c)
    const report = currentReport(deps, c.req.param('id'))
    if (!report) throw notFound('Report', c.req.param('id'))
    loadCaseForRead(db, report.caseId)
    const format = c.req.query('format') ?? 'html'
    const base = `${report.caseId}-${report.kind.toLowerCase()}-v${report.major}.${report.minor}`
    if (format === 'json') {
      c.header('Content-Disposition', `attachment; filename="${base}.json"`)
      return c.json({ ...report, integrity: { contentHash: report.contentHash, algorithm: 'SHA-256 over canonical JSON of content' } })
    }
    const users = listUsers(db)
    const name = (uid: string) => users.find((u) => u.id === uid)?.name ?? uid
    if (format === 'md') {
      c.header('Content-Type', 'text/markdown; charset=utf-8')
      c.header('Content-Disposition', `attachment; filename="${base}.md"`)
      return c.body(renderMarkdown(report, name))
    }
    if (format !== 'html') throw invalid('Unknown format', 'Export formats are html, md and json.')
    c.header('Content-Type', 'text/html; charset=utf-8')
    c.header('Content-Disposition', `attachment; filename="${base}.html"`)
    // The exported document carries its own restrictive policy when opened from disk.
    return c.body(renderHtml(report, name))
  })
}

function renderMarkdown(r: ReportVersion, name: (id: string) => string): string {
  const out: string[] = []
  const content: ReportContent = r.content
  out.push(`# ${mdCell(content.heading)} v${r.major}.${r.minor}`, '')
  out.push(`${mdCell(content.subheading)}`, '')
  out.push(`- Case: ${mdCell(r.caseId)}`, `- Generated: ${r.generatedAt} by ${mdCell(name(r.generatedBy))}`, `- Rule set: ${mdCell(r.ruleSetVersion)}`, `- Content hash (SHA-256): \`${r.contentHash}\``, `- Stage: ${r.stage}`, '')
  for (const s of content.sections) {
    out.push(`## ${mdCell(s.title)}`, '')
    for (const p of s.paragraphs) out.push(mdCell(p), '')
    if (s.facts?.length) {
      out.push('| Field | Value |', '| --- | --- |')
      for (const [k, v] of s.facts) out.push(`| ${mdCell(k)} | ${mdCell(v)} |`)
      out.push('')
    }
    if (s.table) {
      out.push(`| ${s.table.columns.map(mdCell).join(' | ')} |`, `| ${s.table.columns.map(() => '---').join(' | ')} |`)
      for (const row of s.table.rows) out.push(`| ${row.map(mdCell).join(' | ')} |`)
      out.push('')
    }
  }
  out.push('---', '', `_${DISCLAIMER}_`, '')
  return out.join('\n')
}

function renderHtml(r: ReportVersion, name: (id: string) => string): string {
  const e = escapeHtml
  const content = r.content
  const sections = content.sections
    .map((s, i) => {
      const paras = s.paragraphs.map((p) => `<p>${e(p)}</p>`).join('')
      const facts = s.facts?.length ? `<dl>${s.facts.map(([k, v]) => `<dt>${e(k)}</dt><dd>${e(v)}</dd>`).join('')}</dl>` : ''
      const table = s.table
        ? `<table><thead><tr>${s.table.columns.map((col) => `<th>${e(col)}</th>`).join('')}</tr></thead><tbody>${s.table.rows.map((row) => `<tr>${row.map((cell) => `<td>${e(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
        : ''
      return `<section><h2><span>${String(i + 1).padStart(2, '0')}</span>${e(s.title)}</h2>${paras}${facts}${table}</section>`
    })
    .join('')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(content.heading)} v${r.major}.${r.minor} -- ${e(r.caseId)}</title>
<style>
body{font:14px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1c1b19;background:#f4f2ee;margin:0;padding:40px 16px}
main{max-width:860px;margin:0 auto;background:#fff;padding:56px 64px;border:1px solid #e3dfd7;border-radius:14px}
header{border-bottom:2px solid #1c1b19;padding-bottom:24px;margin-bottom:32px}
.kicker{font:600 11px/1 ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:#6b665d}
h1{font-size:28px;margin:12px 0 6px;letter-spacing:-.01em}
.meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 24px;margin-top:20px;font-size:12px}
.meta b{display:block;font:600 10px/1.4 ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase;color:#6b665d}
.mono,td,dd{overflow-wrap:anywhere}
h2{font-size:15px;margin:36px 0 12px;display:flex;gap:12px;align-items:baseline}
h2 span{font:600 11px ui-monospace,monospace;color:#9a948a}
table{width:100%;border-collapse:collapse;font-size:12px;margin:12px 0}
th{text-align:left;font:600 10px ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;color:#6b665d;border-bottom:1px solid #d8d3ca;padding:6px 8px}
td{border-bottom:1px solid #eeeae3;padding:6px 8px;vertical-align:top}
dl{display:grid;grid-template-columns:200px minmax(0,1fr);gap:6px 16px;font-size:13px}
dt{color:#6b665d}dd{margin:0}
footer{margin-top:48px;padding-top:16px;border-top:1px solid #d8d3ca;font-size:11px;color:#6b665d}
@media print{body{background:#fff;padding:0}main{border:0;padding:0}}
</style></head><body><main>
<header><div class="kicker">${e(content.organization)} · ${e(r.caseId)} · Report v${r.major}.${r.minor}</div>
<h1>${e(content.heading)}</h1><div>${e(content.subheading)}</div>
<div class="meta"><div><b>Generated</b>${e(r.generatedAt)}</div><div><b>Generated by</b>${e(name(r.generatedBy))}</div>
<div><b>Rule set</b>${e(r.ruleSetVersion)}</div><div><b>Stage</b>${e(r.stage.replace(/_/g, ' '))}</div>
<div><b>Case status at generation</b>${e(r.caseStatus.replace(/_/g, ' '))}</div><div><b>Evidence state</b>${r.evidenceCount} items · ${e(r.evidenceStateHash.slice(0, 16))}</div>
<div style="grid-column:1/-1"><b>Content hash (SHA-256)</b><span class="mono">${e(r.contentHash)}</span></div></div></header>
${sections}
<footer>${e(content.disclaimer)}</footer>
</main></body></html>`
}
