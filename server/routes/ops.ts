import { z } from 'zod'
import type { Hono } from 'hono'
import type { AwarenessCriterion, EscalationRule, Organization } from '../../types/domain.ts'
import type { AgendaItem, NotificationsResponse, OverviewResponse, SearchResult, SettingsResponse, SystemStatus } from '../../types/api.ts'
import { RULE_SET } from '../../rules/cra-article14.ts'
import { computeAnalytics, escalationFor } from '../../lib/engine/analytics.ts'
import type { Range } from '../../lib/engine/analytics.ts'
import { isRunning } from '../../lib/engine/deadlines.ts'
import { buildVex } from '../../lib/engine/vex.ts'
import { ms } from '../../lib/engine/time.ts'
import { csvCell } from '../../lib/text.ts'
import type { Deps, Env } from '../context.ts'
import { nowIso, requirePermission, requireUser } from '../context.ts'
import { getMeta, tx } from '../db.ts'
import { invalid, notFound } from '../errors.ts'
import { appendAudit, ledgerHead, readLedger } from '../ledger.ts'
import { loadCaseForRead } from '../authz.ts'
import {
  getOrg,
  listComponents,
  listCriteria,
  listEscalation,
  listEvidence,
  listNotifications,
  listProducts,
  listReports,
  listUsers,
  listVulnerabilities,
  loadBundle,
  summarize,
  updateJson,
} from '../repo.ts'
import { ALLOWED_TYPES } from '../evidence-store.ts'
import { allAnalyzed, analyze, redactBundle, toListItem } from '../services.ts'
import { canReadEvidence } from '../authz.ts'
import { id, line, parseBody, requiredLine, role, text, evidenceType } from '../validation.ts'
import { selfTest } from '../selftest.ts'

export function opsRoutes(app: Hono<Env>, deps: Deps): void {
  const { db, config } = deps

  app.get('/api/overview', (c) => {
    requireUser(c)
    const analyzed = allAnalyzed(deps).filter(({ bundle }) => bundle.case.lifecycle === 'open')
    const items = analyzed.map(({ bundle, analysis }) => ({ item: toListItem(db, bundle, analysis), bundle, analysis }))
    const agenda: AgendaItem[] = []
    for (const { bundle, analysis } of analyzed) {
      for (const d of analysis.deadlines) {
        if (!isRunning(d)) continue
        agenda.push({
          caseId: bundle.case.id,
          caseTitle: bundle.case.title,
          cve: bundle.vulnerability.cve,
          product: bundle.products.map((p) => p.name).join(', '),
          ownerId: bundle.case.ownerId,
          deadline: d,
        })
      }
    }
    agenda.sort((a, b) => ms(a.deadline.dueAt!) - ms(b.deadline.dueAt!))
    const withClock = items
      .filter(({ analysis }) => analysis.nextDeadline)
      .sort((a, b) => ms(a.analysis.nextDeadline!.dueAt!) - ms(b.analysis.nextDeadline!.dueAt!))
    const top = withClock[0]
    const attention: OverviewResponse['attention'] = []
    for (const { bundle, analysis } of analyzed) {
      for (const q of analysis.quality.filter((x) => x.severity === 'error')) {
        attention.push({ kind: 'quality', caseId: bundle.case.id, title: q.title, detail: q.detail, tab: q.tab, severity: 'critical' })
      }
      for (const r of analysis.pendingReviews) {
        attention.push({ kind: 'review', caseId: bundle.case.id, title: `Review required: ${r.kind.replace(/_/g, ' ').toLowerCase()}`, detail: `${r.reportId} is awaiting internal review.`, tab: 'report', severity: 'watch' })
      }
      if (!analysis.gaps.canFinalize && analysis.gaps.gaps.length) {
        const g = analysis.gaps.gaps[0]!
        attention.push({ kind: 'gap', caseId: bundle.case.id, title: `Evidence gap: ${g.label}`, detail: g.nextAction, tab: g.tab, severity: analysis.deadlines.some(isRunning) ? 'watch' : 'info' })
      }
    }
    const rank = { critical: 0, watch: 1, info: 2 }
    attention.sort((a, b) => rank[a.severity] - rank[b.severity])
    const running = agenda.map((a) => a.deadline)
    const body: OverviewResponse = {
      now: nowIso(deps),
      counts: {
        activeClocks: new Set(agenda.map((a) => a.caseId)).size,
        critical: running.filter((d) => d.status === 'CRITICAL' || d.status === 'OVERDUE').length,
        openDeterminations: analyzed.filter(({ analysis }) => !analysis.decision && (analysis.clock.vulnerabilityAwareness || analysis.clock.exploitationAwareness)).length,
        // Product determinations, the same unit as the Determinations page this tile links to.
        underInvestigation: analyzed.reduce((n, { analysis }) => n + Object.values(analysis.determinations).filter((d) => d.result === 'UNDER_INVESTIGATION').length, 0),
        evidenceGaps: analyzed.reduce((n, { analysis }) => n + analysis.completeness.missing.length, 0),
      },
      activeClock: top
        ? {
            item: top.item,
            analysis: {
              clock: top.analysis.clock,
              deadlines: top.analysis.deadlines,
              transitional: top.analysis.transitional,
              status: top.analysis.status,
              nextDeadline: top.analysis.nextDeadline,
            },
          }
        : null,
      agenda,
      attention: attention.slice(0, 8),
      recent: readLedger(db, { limit: 40 }).filter((e) => e.eventType !== 'SESSION_STARTED').slice(-8),
    }
    return c.json(body)
  })

  app.get('/api/determinations', (c) => {
    requireUser(c)
    const items = allAnalyzed(deps).flatMap(({ bundle, analysis }) =>
      bundle.products.map((p) => {
        const d = analysis.determinations[p.id] ?? null
        const e = analysis.evaluations[p.id] ?? null
        const pc = bundle.productComponents.find((x) => x.productId === p.id && x.componentId === bundle.vulnerability.componentId)
        return {
          caseId: bundle.case.id,
          caseTitle: bundle.case.title,
          lifecycle: bundle.case.lifecycle,
          cve: bundle.vulnerability.cve ?? bundle.vulnerability.id,
          component: bundle.components.find((x) => x.id === bundle.vulnerability.componentId)?.name ?? null,
          componentVersion: pc?.version ?? null,
          product: { id: p.id, name: p.name, version: p.version },
          determination: d,
          evaluation: e,
          history: bundle.determinations.filter((x) => x.productId === p.id).length,
        }
      }),
    )
    return c.json({ items })
  })

  app.get('/api/clocks', (c) => {
    requireUser(c)
    const items = allAnalyzed(deps).map(({ bundle, analysis }) => ({
      caseId: bundle.case.id,
      caseTitle: bundle.case.title,
      cve: bundle.vulnerability.cve,
      products: bundle.products.map((p) => p.name).join(', '),
      ownerId: bundle.case.ownerId,
      lifecycle: bundle.case.lifecycle,
      status: analysis.status,
      awarenessInstant: analysis.clock.awarenessInstant,
      applicability: analysis.transitional.result,
      deadlines: analysis.deadlines,
    }))
    return c.json({ items, now: nowIso(deps) })
  })

  app.get('/api/analytics', (c) => {
    requireUser(c)
    const range = (c.req.query('range') ?? '30d') as Range
    if (!['7d', '30d', '90d', 'all'].includes(range)) throw invalid('Unknown range', 'Ranges are 7d, 30d, 90d and all.')
    const result = computeAnalytics(allAnalyzed(deps), listReports(db).map(summarize), range, nowIso(deps))
    return c.json({ ...result, demoData: getOrg(db).demo })
  })

  app.get('/api/notifications', (c) => {
    const user = requireUser(c)
    const rules = listEscalation(db)
    const escalations: NotificationsResponse['escalations'] = []
    for (const { bundle, analysis } of allAnalyzed(deps)) {
      if (bundle.case.lifecycle !== 'open') continue
      for (const d of analysis.deadlines) {
        const fired = escalationFor(d, rules, nowIso(deps)).filter((n) => n.fired)
        const latest = fired.at(-1)
        if (!latest) continue
        const targeted =
          latest.targetRole === 'owner' ? bundle.case.ownerId === user.id : latest.targetRole === user.role || bundle.case.ownerId === user.id
        if (!targeted) continue
        escalations.push({
          id: `${bundle.case.id}:${d.kind}:${latest.ruleId}`,
          caseId: bundle.case.id,
          caseTitle: bundle.case.title,
          deadlineLabel: d.label,
          dueAt: d.dueAt!,
          level: latest.level,
          label: latest.label,
          targetRole: latest.targetRole,
          firesAt: latest.firesAt,
        })
      }
    }
    const body: NotificationsResponse = { stored: listNotifications(db, user.id), escalations }
    return c.json(body)
  })

  app.post('/api/notifications/:id/read', (c) => {
    const user = requireUser(c)
    db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL').run(nowIso(deps), c.req.param('id'), user.id)
    return c.json({ ok: true })
  })

  app.post('/api/notifications/read-all', (c) => {
    const user = requireUser(c)
    db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(nowIso(deps), user.id)
    return c.json({ ok: true })
  })

  app.get('/api/search', (c) => {
    const user = requireUser(c)
    const q = (c.req.query('q') ?? '').trim().toLowerCase().slice(0, 100)
    if (q.length < 2) return c.json({ results: [] })
    const results: SearchResult[] = []
    const hit = (...fields: Array<string | null | undefined>) => fields.some((f) => f?.toLowerCase().includes(q))
    for (const { bundle, analysis } of allAnalyzed(deps)) {
      if (hit(bundle.case.id, bundle.case.title, bundle.vulnerability.cve, ...bundle.case.tags)) {
        results.push({ kind: 'case', id: bundle.case.id, label: bundle.case.title, sublabel: `${bundle.case.id} · ${analysis.status.replace(/_/g, ' ')}`, href: `/cases/${bundle.case.id}` })
      }
    }
    for (const v of listVulnerabilities(db)) {
      if (hit(v.cve, v.id, v.title, v.cwe)) results.push({ kind: 'vulnerability', id: v.id, label: v.cve ?? v.id, sublabel: v.title, href: `/vulnerabilities/${v.id}` })
    }
    for (const p of listProducts(db)) {
      if (hit(p.id, p.name)) results.push({ kind: 'product', id: p.id, label: p.name, sublabel: `${p.id} · v${p.version}`, href: `/products/${p.id}` })
    }
    for (const comp of listComponents(db)) {
      if (hit(comp.name, comp.purl)) results.push({ kind: 'component', id: comp.id, label: comp.name, sublabel: comp.purl, href: `/products?view=components&q=${encodeURIComponent(comp.id)}` })
    }
    for (const e of listEvidence(db)) {
      if (canReadEvidence(user, e) && hit(e.id, e.title, e.sha256)) results.push({ kind: 'evidence', id: e.id, label: e.title, sublabel: `${e.id} · ${e.type.replace(/_/g, ' ')}`, href: `/evidence/${e.id}` })
    }
    return c.json({ results: results.slice(0, 30) })
  })

  app.get('/api/system/status', (c) => {
    requireUser(c)
    const st = selfTest()
    const last = getMeta(db, 'last_verification')
    const lv = last ? (JSON.parse(last) as { at: string; ok: boolean; checked: number; headSeq: number }) : null
    const head = ledgerHead(db)
    const integrity = getMeta(db, 'integrity_check')
    const ic = integrity ? (JSON.parse(integrity) as { ok: boolean; detail: string }) : { ok: true, detail: 'Not yet checked.' }
    const body: SystemStatus = {
      ruleEngine: { state: st.rules.ok ? 'operational' : 'degraded', detail: st.rules.detail },
      ledger: lv
        ? {
            state: lv.ok ? 'verified' : 'exception',
            // The verification is itself recorded as the next entry; it is not "new since".
            detail: lv.ok
              ? `${lv.checked} entries verified${head.seq - lv.headSeq - 1 > 0 ? `; ${head.seq - lv.headSeq - 1} appended since` : ''}.`
              : 'Chain verification found an integrity exception.',
            at: lv.at,
          }
        : { state: 'unverified', detail: 'The ledger has not been verified yet.', at: null },
      deadlineEngine: { state: st.deadlines.ok ? 'operational' : 'degraded', detail: st.deadlines.detail },
      dataIntegrity: { state: ic.ok ? 'verified' : 'exception', detail: ic.detail },
      ruleSetVersion: RULE_SET.version,
    }
    return c.json(body)
  })

  app.get('/api/rules', (c) => {
    requireUser(c)
    return c.json({ ruleSet: RULE_SET, selfTest: selfTest() })
  })

  // Settings -------------------------------------------------------------------------
  app.get('/api/settings', (c) => {
    requireUser(c)
    const body: SettingsResponse = {
      org: getOrg(db),
      criteria: listCriteria(db),
      escalation: listEscalation(db),
      evidencePolicy: {
        maxUploadBytes: config.maxUploadBytes,
        allowedTypes: Object.values(ALLOWED_TYPES).map((t) => ({ label: t.label, mime: t.mime, extensions: t.extensions })),
      },
      demoMode: config.demoMode,
    }
    return c.json(body)
  })

  const criterionSchema = z.object({
    label: requiredLine(120),
    description: text(1000).pipe(z.string().min(10)),
    scope: z.enum(['vulnerability', 'exploitation']),
    responsibleRole: role,
    requiredEvidenceTypes: z.array(evidenceType).max(8),
    active: z.boolean(),
  })

  app.put('/api/settings/criteria/:id', async (c) => {
    const user = requirePermission(c, 'settings.manage')
    const existing = listCriteria(db).find((k) => k.id === c.req.param('id'))
    if (!existing) throw notFound('Awareness criterion', c.req.param('id'))
    const input = await parseBody(c, criterionSchema)
    const next: AwarenessCriterion = { ...existing, ...input }
    tx(db, () => {
      updateJson(db, 'criteria', existing.id, next)
      appendAudit(db, { actorId: user.id, actorRole: user.role, eventType: 'SETTINGS_CHANGED', objectType: 'awareness_criterion', objectId: existing.id, caseId: null, source: 'ui', summary: `Awareness criterion "${next.label}" updated`, payload: { before: existing, after: next }, at: nowIso(deps) })
    })
    return c.json({ ok: true })
  })

  app.post('/api/settings/criteria', async (c) => {
    const user = requirePermission(c, 'settings.manage')
    const input = await parseBody(c, criterionSchema)
    const next: AwarenessCriterion = { id: `AC-${String(listCriteria(db).length + 1).padStart(2, '0')}`, ...input }
    tx(db, () => {
      db.prepare('INSERT INTO criteria(id, data) VALUES (?, ?)').run(next.id, JSON.stringify(next))
      appendAudit(db, { actorId: user.id, actorRole: user.role, eventType: 'SETTINGS_CHANGED', objectType: 'awareness_criterion', objectId: next.id, caseId: null, source: 'ui', summary: `Awareness criterion "${next.label}" added`, payload: { after: next }, at: nowIso(deps) })
    })
    return c.json({ id: next.id }, 201)
  })

  app.put('/api/settings/escalation', async (c) => {
    const user = requirePermission(c, 'settings.manage')
    const input = await parseBody(
      c,
      z.object({
        rules: z
          .array(
            z.object({
              id: id,
              offsetMinutes: z.number().int().min(0).max(14 * 24 * 60),
              targetRole: z.union([role, z.literal('owner')]),
              level: z.enum(['info', 'watch', 'critical']),
              label: requiredLine(80),
              active: z.boolean(),
            }),
          )
          .max(12),
      }),
    )
    const before = listEscalation(db)
    tx(db, () => {
      db.exec('DELETE FROM escalation_rules')
      for (const r of input.rules as EscalationRule[]) db.prepare('INSERT INTO escalation_rules(id, data) VALUES (?, ?)').run(r.id, JSON.stringify(r))
      appendAudit(db, { actorId: user.id, actorRole: user.role, eventType: 'SETTINGS_CHANGED', objectType: 'escalation_policy', objectId: 'escalation', caseId: null, source: 'ui', summary: `Escalation policy updated (${input.rules.length} steps)`, payload: { before, after: input.rules }, at: nowIso(deps) })
    })
    return c.json({ ok: true })
  })

  app.put('/api/settings/org', async (c) => {
    const user = requirePermission(c, 'settings.manage')
    const input = await parseBody(
      c,
      z.object({
        name: requiredLine(120),
        legalEntity: requiredLine(160),
        timezone: line(64),
        memberStatesMadeAvailable: z.array(z.string().regex(/^[A-Z]{2}$/)).max(27),
        csirtCoordinator: requiredLine(160),
      }),
    )
    const org = getOrg(db)
    const next: Organization = { ...org, ...input }
    tx(db, () => {
      updateJson(db, 'organization', org.id, next)
      appendAudit(db, { actorId: user.id, actorRole: user.role, eventType: 'SETTINGS_CHANGED', objectType: 'organization', objectId: org.id, caseId: null, source: 'ui', summary: 'Organisation settings updated', payload: { before: org, after: next }, at: nowIso(deps) })
    })
    return c.json({ ok: true })
  })

  // Exports ---------------------------------------------------------------------------
  app.get('/api/export/cases', (c) => {
    requireUser(c)
    const format = c.req.query('format') ?? 'csv'
    const items = allAnalyzed(deps).map(({ bundle, analysis }) => toListItem(db, bundle, analysis))
    const users = listUsers(db)
    const stamp = nowIso(deps).slice(0, 10)
    if (format === 'json') {
      c.header('Content-Disposition', `attachment; filename="nexus-cases-${stamp}.json"`)
      return c.json({ exportedAt: nowIso(deps), ruleSetVersion: RULE_SET.version, cases: items })
    }
    if (format !== 'csv') throw invalid('Unknown format', 'Case exports are csv or json.')
    const header = ['case_id', 'title', 'cve', 'severity', 'status', 'lifecycle', 'products', 'owner', 'affectedness', 'next_deadline', 'next_deadline_due', 'next_deadline_status', 'evidence_satisfied', 'evidence_applicable', 'health']
    const rows = items.map((i) => [
      i.id,
      i.title,
      i.cve ?? '',
      i.severity,
      i.status,
      i.lifecycle,
      i.products.map((p) => `${p.name} ${p.version}`).join('; '),
      users.find((u) => u.id === i.ownerId)?.name ?? i.ownerId,
      i.affectedness,
      i.nextDeadline?.label ?? '',
      i.nextDeadline?.dueAt ?? '',
      i.nextDeadline?.status ?? '',
      i.completeness.satisfied,
      i.completeness.applicable,
      i.health.state,
    ])
    const csv = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')
    c.header('Content-Type', 'text/csv; charset=utf-8')
    c.header('Content-Disposition', `attachment; filename="nexus-cases-${stamp}.csv"`)
    return c.body(csv)
  })

  app.get('/api/cases/:id/export', (c) => {
    const user = requireUser(c)
    const theCase = loadCaseForRead(db, c.req.param('id'))
    const bundle = loadBundle(db, theCase.id)!
    const analysis = analyze(deps, bundle)
    c.header('Content-Disposition', `attachment; filename="${theCase.id}-case-record.json"`)
    return c.json({
      kind: 'nexus-case-record',
      exportedAt: nowIso(deps),
      exportedBy: user.id,
      ruleSetVersion: RULE_SET.version,
      disclaimer: 'Decision-support record. Not legal advice or a legal determination of compliance.',
      bundle: redactBundle(user, bundle),
      analysis,
      ledger: readLedger(db, { caseId: theCase.id }),
    })
  })

  app.get('/api/cases/:id/vex', (c) => {
    requireUser(c)
    const theCase = loadCaseForRead(db, c.req.param('id'))
    const bundle = loadBundle(db, theCase.id)!
    const users = listUsers(db)
    const vex = buildVex(bundle, analyze(deps, bundle), getOrg(db), (uid) => users.find((u) => u.id === uid)?.name ?? uid, nowIso(deps))
    c.header('Content-Disposition', `attachment; filename="${theCase.id}.openvex.json"`)
    return c.json(vex)
  })
}
