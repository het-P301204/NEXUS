import { z } from 'zod'
import type { Hono } from 'hono'
import type {
  AffectednessStepId,
  Case,
  CaseRelation,
  ClockEvent,
  Comment,
  Decision,
  Determination,
  RoleId,
  StepAnswer,
} from '../../types/domain.ts'
import type { CaseDetailResponse } from '../../types/api.ts'
import { STEPS, evaluateAffectedness, suggestFromSbom } from '../../lib/engine/affectedness.ts'
import { currentDecision, currentDeterminations } from '../../lib/engine/bundle.ts'
import { isRunning } from '../../lib/engine/deadlines.ts'
import { formatRemaining, ms } from '../../lib/engine/time.ts'
import { can } from '../../lib/rbac.ts'
import type { Deps, Env } from '../context.ts'
import { nowIso, requirePermission, requireUser } from '../context.ts'
import { nextId, tx } from '../db.ts'
import { ApiError, conflict, forbidden, invalid, notFound } from '../errors.ts'
import { recordHash } from '../hash.ts'
import { appendAudit, readLedger } from '../ledger.ts'
import { assertCaseOpen, canWriteCase, loadCaseForRead, loadCaseForWrite } from '../authz.ts'
import {
  getProduct,
  getUser,
  getVulnerability,
  insertCase,
  insertComment,
  insertDecision,
  insertDetermination,
  insertEvent,
  insertLink,
  insertRelation,
  listCases,
  listComments,
  listCriteria,
  listRelations,
  listUsers,
  loadBundle,
  transitionsFor,
  updateCase,
  updateVulnerability,
} from '../repo.ts'
import { analyze, allAnalyzed, changesSince, notify, redactBundle, toListItem } from '../services.ts'
import { generateReport, recordTransition } from '../reporting.ts'
import {
  answer,
  confidence,
  id,
  idList,
  instant,
  line,
  parseBody,
  requiredLine,
  sourceKind,
  text,
  timezone,
} from '../validation.ts'

const CLOCK_SKEW_MS = 2 * 60 * 1000

function assertNotFuture(deps: Deps, at: string): void {
  if (ms(at) > deps.now().getTime() + CLOCK_SKEW_MS) {
    throw new ApiError(422, 'TIMESTAMP_IN_FUTURE', 'Timestamp in the future', `The asserted time ${at} is later than the server clock. A clock-of-record event cannot be recorded before it happens.`)
  }
  if (ms(at) < Date.parse('2000-01-01T00:00:00Z')) {
    throw invalid('Timestamp out of range', 'Timestamps before 2000 are rejected as implausible.')
  }
}

function assertEvidenceInCase(bundleEvidenceIds: Set<string>, ids: string[]): void {
  const foreign = ids.filter((e) => !bundleEvidenceIds.has(e))
  if (foreign.length > 0) {
    throw invalid('Evidence not in this case', `Evidence ${foreign.join(', ')} does not belong to this case. Evidence can only support records in its own case.`)
  }
}

export function caseRoutes(app: Hono<Env>, deps: Deps): void {
  const { db } = deps

  // List ---------------------------------------------------------------------
  app.get('/api/cases', (c) => {
    requireUser(c)
    const items = allAnalyzed(deps).map(({ bundle, analysis }) => toListItem(db, bundle, analysis))
    return c.json({ items, now: nowIso(deps) })
  })

  // Detail -------------------------------------------------------------------
  app.get('/api/cases/:id', (c) => {
    const user = requireUser(c)
    const theCase = loadCaseForRead(db, c.req.param('id'))
    const bundle = loadBundle(db, theCase.id)!
    const analysis = analyze(deps, bundle)
    const cases = listCases(db)
    const relations = listRelations(db, theCase.id).map((r) => {
      const otherId = r.caseId === theCase.id ? r.relatedCaseId : r.caseId
      const otherBundle = loadBundle(db, otherId)!
      return { ...r, other: { id: otherId, title: otherBundle.case.title, status: analyze(deps, otherBundle).status } }
    })
    const related = new Set(relations.map((r) => r.other.id))
    const suggestedRelations = cases
      .filter((x) => x.id !== theCase.id && !related.has(x.id))
      .map((x) => {
        const reasons: string[] = []
        if (x.vulnerabilityId === theCase.vulnerabilityId) reasons.push('Same vulnerability')
        const shared = x.productIds.filter((p) => theCase.productIds.includes(p))
        if (shared.length) reasons.push(`Shares ${shared.map((p) => getProduct(db, p)?.name ?? p).join(', ')}`)
        return { x, reasons }
      })
      .filter(({ reasons }) => reasons.some((r) => r === 'Same vulnerability'))
      .map(({ x, reasons }) => ({ id: x.id, title: x.title, reason: reasons.join(' · '), status: analyze(deps, loadBundle(db, x.id)!).status }))
    const sbom: CaseDetailResponse['sbom'] = {}
    for (const p of bundle.products) {
      sbom[p.id] = suggestFromSbom(bundle.vulnerability, p, bundle.productComponents, bundle.components).suggestions
    }
    const transitions = bundle.reports.flatMap((r) => transitionsFor(db, r.id))
    const body: CaseDetailResponse = {
      bundle: redactBundle(user, bundle),
      analysis,
      comments: listComments(db, theCase.id),
      relations,
      suggestedRelations,
      ledger: readLedger(db, { caseId: theCase.id }),
      changes: changesSince(db, theCase.id, user.id),
      sbom,
      transitions,
      canWrite: canWriteCase(user, theCase) && theCase.lifecycle === 'open',
    }
    return c.json(body)
  })

  // Create -------------------------------------------------------------------
  const createSchema = z.object({
    title: requiredLine(160),
    vulnerabilityId: id,
    productIds: z.array(id).min(1, 'Select at least one product').max(20),
    ownerId: id.optional(),
    collaboratorIds: z.array(id).max(20).default([]),
    tags: z.array(line(40)).max(12).default([]),
    summary: text(4000).default(''),
  })

  function createCase(actorId: string, actorRole: RoleId, input: z.output<typeof createSchema>, source: 'ui' | 'import' = 'ui'): Case {
    const vuln = getVulnerability(db, input.vulnerabilityId)
    if (!vuln) throw notFound('Vulnerability', input.vulnerabilityId)
    for (const p of input.productIds) if (!getProduct(db, p)) throw notFound('Product', p)
    const ownerId = input.ownerId ?? actorId
    if (!getUser(db, ownerId)) throw notFound('User', ownerId)
    const now = nowIso(deps)
    const year = now.slice(0, 4)
    const theCase: Case = {
      id: nextId(db, `CASE-${year}`),
      title: input.title,
      vulnerabilityId: vuln.id,
      ownerId,
      collaboratorIds: [...new Set(input.collaboratorIds.filter((u) => u !== ownerId && getUser(db, u)))],
      tags: [...new Set(input.tags.filter(Boolean))],
      lifecycle: 'open',
      lifecycleReason: null,
      productIds: [...new Set(input.productIds)],
      createdAt: now,
      createdBy: actorId,
      summary: input.summary,
    }
    insertCase(db, theCase)
    appendAudit(db, {
      actorId,
      actorRole,
      eventType: 'CASE_CREATED',
      objectType: 'case',
      objectId: theCase.id,
      caseId: theCase.id,
      source,
      summary: `${theCase.id} opened for ${vuln.cve ?? vuln.id}`,
      payload: { vulnerabilityId: vuln.id, productIds: theCase.productIds, ownerId },
      at: now,
    })
    if (ownerId !== actorId) {
      notify(deps, {
        userIds: [ownerId],
        kind: 'case_assigned',
        severity: 'info',
        title: `${theCase.id} assigned to you`,
        body: theCase.title,
        caseId: theCase.id,
        link: `/cases/${theCase.id}`,
      })
    }
    return theCase
  }

  app.post('/api/cases', async (c) => {
    const user = requirePermission(c, 'case.create')
    const input = await parseBody(c, createSchema)
    if (input.ownerId && input.ownerId !== user.id && !can(user.role, 'case.assign')) {
      throw forbidden('Assigning a new case to someone else requires the case.assign permission.')
    }
    const created = tx(db, () => createCase(user.id, user.role, input))
    return c.json({ id: created.id }, 201)
  })

  app.post('/api/cases/:id/duplicate', (c) => {
    const user = requirePermission(c, 'case.create')
    const source = loadCaseForRead(db, c.req.param('id'))
    const created = tx(db, () => {
      const copy = createCase(user.id, user.role, {
        title: `${source.title} (copy)`,
        vulnerabilityId: source.vulnerabilityId,
        productIds: source.productIds,
        collaboratorIds: [],
        tags: source.tags,
        summary: source.summary,
      })
      const rel: CaseRelation = {
        id: nextId(db, 'REL'),
        caseId: copy.id,
        relatedCaseId: source.id,
        relation: 'RELATED_CVE',
        note: `Duplicated from ${source.id}. History stays with the original case.`,
        createdBy: user.id,
        createdAt: nowIso(deps),
      }
      insertRelation(db, rel)
      appendAudit(db, {
        actorId: user.id,
        actorRole: user.role,
        eventType: 'CASE_RELATION_ADDED',
        objectType: 'case_relation',
        objectId: rel.id,
        caseId: copy.id,
        source: 'ui',
        summary: `${copy.id} duplicated from ${source.id}`,
        payload: { relationId: rel.id, relatedCaseId: rel.relatedCaseId, relation: rel.relation },
        at: rel.createdAt,
      })
      return copy
    })
    return c.json({ id: created.id }, 201)
  })

  // Update -------------------------------------------------------------------
  const patchSchema = z.object({
    title: requiredLine(160).optional(),
    summary: text(4000).optional(),
    tags: z.array(line(40)).max(12).optional(),
    collaboratorIds: z.array(id).max(20).optional(),
    productIds: z.array(id).min(1).max(20).optional(),
  })

  app.patch('/api/cases/:id', async (c) => {
    const user = requirePermission(c, 'case.edit')
    const theCase = loadCaseForWrite(db, user, c.req.param('id'))
    const input = await parseBody(c, patchSchema)
    if (input.productIds) for (const p of input.productIds) if (!getProduct(db, p)) throw notFound('Product', p)
    const next: Case = {
      ...theCase,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.summary !== undefined ? { summary: input.summary } : {}),
      ...(input.tags !== undefined ? { tags: [...new Set(input.tags.filter(Boolean))] } : {}),
      ...(input.collaboratorIds !== undefined
        ? { collaboratorIds: [...new Set(input.collaboratorIds.filter((u) => u !== theCase.ownerId && getUser(db, u)))] }
        : {}),
      ...(input.productIds !== undefined ? { productIds: [...new Set(input.productIds)] } : {}),
    }
    const changed = Object.keys(input)
    tx(db, () => {
      updateCase(db, next)
      appendAudit(db, {
        actorId: user.id,
        actorRole: user.role,
        eventType: 'CASE_UPDATED',
        objectType: 'case',
        objectId: theCase.id,
        caseId: theCase.id,
        source: 'ui',
        summary: `${theCase.id} updated: ${changed.join(', ')}`,
        payload: { fields: changed, before: Object.fromEntries(changed.map((k) => [k, theCase[k as keyof Case]])), after: input },
        at: nowIso(deps),
      })
    })
    return c.json({ ok: true })
  })

  app.post('/api/cases/:id/assign', async (c) => {
    const user = requirePermission(c, 'case.assign')
    const theCase = loadCaseForWrite(db, user, c.req.param('id'))
    const { ownerId } = await parseBody(c, z.object({ ownerId: id }))
    const owner = getUser(db, ownerId)
    if (!owner || !owner.active) throw notFound('User', ownerId)
    if (owner.role === 'read_only') throw invalid('Owner cannot hold cases', 'A Read Only user cannot own a case.')
    tx(db, () => {
      updateCase(db, { ...theCase, ownerId, collaboratorIds: [...new Set([...theCase.collaboratorIds.filter((u) => u !== ownerId), theCase.ownerId])] })
      appendAudit(db, {
        actorId: user.id,
        actorRole: user.role,
        eventType: 'CASE_OWNER_CHANGED',
        objectType: 'case',
        objectId: theCase.id,
        caseId: theCase.id,
        source: 'ui',
        summary: `${theCase.id} ownership transferred to ${owner.name}`,
        payload: { from: theCase.ownerId, to: ownerId },
        at: nowIso(deps),
      })
      notify(deps, {
        userIds: [ownerId],
        exclude: user.id,
        kind: 'case_assigned',
        severity: 'info',
        title: `${theCase.id} transferred to you`,
        body: theCase.title,
        caseId: theCase.id,
        link: `/cases/${theCase.id}`,
      })
    })
    return c.json({ ok: true })
  })

  app.post('/api/cases/:id/lifecycle', async (c) => {
    const user = requireUser(c)
    const input = await parseBody(
      c,
      z.object({ action: z.enum(['close', 'reopen', 'archive']), reason: text(1000).pipe(z.string().min(10, 'Give a reason of at least 10 characters')) }),
    )
    const perm = input.action === 'close' ? 'case.close' : input.action === 'reopen' ? 'case.reopen' : 'case.archive'
    requirePermission(c, perm)
    const theCase = loadCaseForRead(db, c.req.param('id'))
    const bundle = loadBundle(db, theCase.id)!
    const analysis = analyze(deps, bundle)
    let lifecycle: Case['lifecycle']
    if (input.action === 'reopen') {
      if (theCase.lifecycle === 'open') throw conflict('CASE_ALREADY_OPEN', 'Case is open', `${theCase.id} is already open.`)
      lifecycle = 'open'
    } else {
      if (!canWriteCase(user, theCase)) throw forbidden(`You are not the owner or a collaborator on ${theCase.id}.`)
      if (input.action === 'close' && theCase.lifecycle !== 'open') throw conflict('CASE_NOT_OPEN', 'Case is not open', `${theCase.id} is ${theCase.lifecycle}.`)
      const running = analysis.deadlines.filter(isRunning)
      if (running.length > 0) {
        throw conflict(
          'CASE_CLOSE_BLOCKED',
          'Case cannot be closed',
          `The ${running[0]!.label.toLowerCase()} deadline is still running (due ${running[0]!.dueAt}). Submit it, or record a decision that reporting is not required, before closing.`,
          { label: 'Open Clock of Record', href: `/cases/${theCase.id}?tab=clock` },
        )
      }
      // A decision not to report that is not in force yet (its record is still in
      // review, or later awareness overtook it) is not a reason to close.
      const standing = analysis.decisionStanding
      if (input.action === 'close' && analysis.decision?.outcome === 'DO_NOT_REPORT' && standing && !standing.inForce) {
        throw conflict('CASE_CLOSE_BLOCKED', 'Case cannot be closed', standing.reason ?? `${analysis.decision.id} is not in force.`, {
          label: 'Open Report tab',
          href: `/cases/${theCase.id}?tab=report`,
        })
      }
      lifecycle = input.action === 'close' ? 'closed' : 'archived'
    }
    tx(db, () => {
      updateCase(db, { ...theCase, lifecycle, lifecycleReason: input.reason })
      appendAudit(db, {
        actorId: user.id,
        actorRole: user.role,
        eventType: 'CASE_LIFECYCLE_CHANGED',
        objectType: 'case',
        objectId: theCase.id,
        caseId: theCase.id,
        source: 'ui',
        summary: `${theCase.id} ${input.action === 'reopen' ? 'reopened' : input.action === 'close' ? 'closed' : 'archived'}: ${input.reason}`,
        payload: { from: theCase.lifecycle, to: lifecycle, reason: input.reason },
        at: nowIso(deps),
      })
    })
    return c.json({ ok: true, lifecycle })
  })

  // Clock events --------------------------------------------------------------
  const eventSchema = z.object({
    type: z.enum(['OCCURRENCE', 'DETECTION', 'VULNERABILITY_AWARENESS', 'EXPLOITATION_AWARENESS', 'MEASURE_AVAILABLE']),
    occurredAt: instant,
    timezone,
    source: requiredLine(240),
    sourceKind,
    evidenceIds: idList.default([]),
    criterionId: id.nullable().default(null),
    note: text(2000).default(''),
    confirmExploitation: z.boolean().default(false),
  })

  app.post('/api/cases/:id/events', async (c) => {
    const user = requireUser(c)
    const input = await parseBody(c, eventSchema)
    const awareness = input.type === 'VULNERABILITY_AWARENESS' || input.type === 'EXPLOITATION_AWARENESS'
    requirePermission(c, awareness ? 'awareness.establish' : 'clock.record')
    const theCase = loadCaseForWrite(db, user, c.req.param('id'))
    const bundle = loadBundle(db, theCase.id)!
    assertNotFuture(deps, input.occurredAt)
    assertEvidenceInCase(new Set(bundle.evidence.map((e) => e.id)), input.evidenceIds)

    const existing = bundle.events.find((e) => e.type === input.type)
    if (existing) {
      throw conflict(
        'EVENT_ALREADY_RECORDED',
        `${input.type.replace(/_/g, ' ').toLowerCase()} already recorded`,
        `${existing.id} already records this event. Historical timestamps are not re-recorded; record a correction that preserves the original.`,
        { label: 'Record a correction', href: `/cases/${theCase.id}?tab=clock&correct=${existing.id}` },
      )
    }

    let responsibleRole: RoleId | null = null
    if (awareness) {
      const scope = input.type === 'VULNERABILITY_AWARENESS' ? 'vulnerability' : 'exploitation'
      const criterion = listCriteria(db).find((k) => k.id === input.criterionId)
      if (!criterion || !criterion.active || criterion.scope !== scope) {
        throw invalid(
          'Awareness criterion required',
          `Awareness is established against one of the organisation's active ${scope}-awareness criteria. Select the criterion that was met.`,
          { criterionId: 'Select an active criterion' },
        )
      }
      if (criterion.requiredEvidenceTypes.length > 0) {
        const types = new Set(bundle.evidence.filter((e) => input.evidenceIds.includes(e.id)).map((e) => e.type))
        if (!criterion.requiredEvidenceTypes.some((t) => types.has(t))) {
          throw new ApiError(
            422,
            'AWARENESS_EVIDENCE_REQUIRED',
            'Awareness evidence required',
            `Criterion "${criterion.label}" requires evidence of type ${criterion.requiredEvidenceTypes.map((t) => t.replace(/_/g, ' ').toLowerCase()).join(' or ')}. Attach it to the case, then link it here.`,
            { action: { label: 'Add evidence', href: `/cases/${theCase.id}?tab=evidence` } },
          )
        }
      }
      responsibleRole = criterion.responsibleRole
      if (input.type === 'EXPLOITATION_AWARENESS' && bundle.vulnerability.exploitation !== 'CONFIRMED' && !input.confirmExploitation) {
        throw conflict(
          'EXPLOITATION_NOT_CONFIRMED',
          'Exploitation is not confirmed',
          `The vulnerability record says exploitation is ${bundle.vulnerability.exploitation.replace(/_/g, ' ').toLowerCase()}. Establishing exploitation awareness asserts reliable evidence of exploitation (Art. 3(42)). Confirm the status change explicitly.`,
        )
      }
    }

    const now = nowIso(deps)
    const base: Omit<ClockEvent, 'integrityHash'> = {
      id: nextId(db, 'CE'),
      caseId: theCase.id,
      type: input.type,
      occurredAt: input.occurredAt,
      timezone: input.timezone,
      actorId: user.id,
      source: input.source,
      sourceKind: input.sourceKind,
      evidenceIds: input.evidenceIds,
      criterionId: awareness ? input.criterionId : null,
      responsibleRole,
      supersedesId: null,
      correctionReason: null,
      decisionId: null,
      reportId: null,
      note: input.note,
      recordedAt: now,
    }
    const event: ClockEvent = { ...base, integrityHash: recordHash(base) }

    tx(db, () => {
      if (input.type === 'EXPLOITATION_AWARENESS' && bundle.vulnerability.exploitation !== 'CONFIRMED') {
        updateVulnerability(db, { ...bundle.vulnerability, exploitation: 'CONFIRMED' })
        appendAudit(db, {
          actorId: user.id,
          actorRole: user.role,
          eventType: 'VULNERABILITY_EXPLOITATION_UPDATED',
          objectType: 'vulnerability',
          objectId: bundle.vulnerability.id,
          caseId: theCase.id,
          source: 'ui',
          summary: `${bundle.vulnerability.cve ?? bundle.vulnerability.id} exploitation ${bundle.vulnerability.exploitation} -> CONFIRMED`,
          payload: { from: bundle.vulnerability.exploitation, to: 'CONFIRMED' },
          at: now,
        })
      }
      insertEvent(db, event)
      for (const e of input.evidenceIds) insertLink(db, { evidenceId: e, targetType: 'clock_event', targetId: event.id }, now, user.id)
      appendAudit(db, {
        actorId: user.id,
        actorRole: user.role,
        eventType: awareness ? 'AWARENESS_ESTABLISHED' : 'CLOCK_EVENT_RECORDED',
        objectType: 'clock_event',
        objectId: event.id,
        caseId: theCase.id,
        source: 'ui',
        summary: `${event.id} ${input.type.replace(/_/g, ' ').toLowerCase()} at ${input.occurredAt}`,
        payload: { eventId: event.id, type: event.type, occurredAt: event.occurredAt, sourceKind: event.sourceKind, integrityHash: event.integrityHash, criterionId: event.criterionId },
        at: now,
      })
      if (awareness) {
        const after = analyze(deps, loadBundle(db, theCase.id)!)
        const ew = after.deadlines.find((d) => d.kind === 'EARLY_WARNING')
        notify(deps, {
          userIds: [theCase.ownerId],
          roles: ['psirt_lead', 'security_manager'],
          exclude: user.id,
          kind: 'awareness_established',
          severity: input.type === 'EXPLOITATION_AWARENESS' ? 'critical' : 'watch',
          title: `${input.type === 'EXPLOITATION_AWARENESS' ? 'Exploitation' : 'Vulnerability'} awareness established -- ${theCase.id}`,
          body:
            ew?.dueAt && isRunning(ew)
              ? `Reporting clock started. Early warning due ${ew.dueAt} (${formatRemaining(ew.remainingMs ?? 0)} remaining).`
              : `${event.id} recorded against criterion ${input.criterionId}.`,
          caseId: theCase.id,
          link: `/cases/${theCase.id}?tab=clock`,
        })
      }
    })
    return c.json({ id: event.id }, 201)
  })

  const correctionSchema = z.object({
    occurredAt: instant,
    timezone,
    source: requiredLine(240),
    sourceKind,
    reason: text(2000).pipe(z.string().min(20, 'Explain the correction in at least 20 characters')),
    evidenceIds: idList.default([]),
  })

  app.post('/api/cases/:id/events/:eventId/correct', async (c) => {
    const user = requirePermission(c, 'clock.correct')
    const theCase = loadCaseForWrite(db, user, c.req.param('id'))
    const input = await parseBody(c, correctionSchema)
    const bundle = loadBundle(db, theCase.id)!
    const target = bundle.events.find((e) => e.id === c.req.param('eventId'))
    if (!target) throw notFound('Clock event', c.req.param('eventId'))
    let root: ClockEvent | undefined = target
    while (root && root.type === 'CORRECTION') root = bundle.events.find((e) => e.id === root!.supersedesId)
    if (!root) throw notFound('Clock event', target.supersedesId ?? target.id)
    if (root.sourceKind === 'nexus_server') {
      throw conflict(
        'CORRECTION_NOT_ALLOWED',
        'Server-witnessed timestamp',
        `${root.id} was witnessed by NEXUS's own clock when it happened (${root.type.replace(/_/g, ' ').toLowerCase()}). Server-witnessed timestamps cannot be corrected.`,
      )
    }
    assertNotFuture(deps, input.occurredAt)
    assertEvidenceInCase(new Set(bundle.evidence.map((e) => e.id)), input.evidenceIds)
    const now = nowIso(deps)
    const base: Omit<ClockEvent, 'integrityHash'> = {
      id: nextId(db, 'CE'),
      caseId: theCase.id,
      type: 'CORRECTION',
      occurredAt: input.occurredAt,
      timezone: input.timezone,
      actorId: user.id,
      source: input.source,
      sourceKind: input.sourceKind,
      evidenceIds: input.evidenceIds,
      criterionId: root.criterionId,
      responsibleRole: root.responsibleRole,
      supersedesId: target.id,
      correctionReason: input.reason,
      decisionId: null,
      reportId: null,
      note: '',
      recordedAt: now,
    }
    const event: ClockEvent = { ...base, integrityHash: recordHash(base) }
    tx(db, () => {
      insertEvent(db, event)
      for (const e of input.evidenceIds) insertLink(db, { evidenceId: e, targetType: 'clock_event', targetId: event.id }, now, user.id)
      appendAudit(db, {
        actorId: user.id,
        actorRole: user.role,
        eventType: 'CLOCK_EVENT_CORRECTED',
        objectType: 'clock_event',
        objectId: event.id,
        caseId: theCase.id,
        source: 'ui',
        summary: `${event.id} corrects ${target.id} (${root!.type.replace(/_/g, ' ').toLowerCase()}): ${target.occurredAt} -> ${input.occurredAt}`,
        payload: { correctionId: event.id, supersedes: target.id, rootType: root!.type, from: target.occurredAt, to: input.occurredAt, reason: input.reason, integrityHash: event.integrityHash },
        at: now,
      })
      notify(deps, {
        userIds: [theCase.ownerId],
        roles: ['psirt_lead'],
        exclude: user.id,
        kind: 'timestamp_corrected',
        severity: 'watch',
        title: `Timestamp corrected -- ${theCase.id}`,
        body: `${root!.type.replace(/_/g, ' ').toLowerCase()} moved from ${target.occurredAt} to ${input.occurredAt}. Dependent deadlines are recalculated; the original stays on the record.`,
        caseId: theCase.id,
        link: `/cases/${theCase.id}?tab=clock`,
      })
    })
    return c.json({ id: event.id }, 201)
  })

  // Determinations ------------------------------------------------------------
  const stepIds = STEPS.map((s) => s.id) as [AffectednessStepId, ...AffectednessStepId[]]
  const determinationSchema = z.object({
    productId: id,
    // partialRecord: a client may omit unanswered steps; they are filled as null below.
    answers: z.partialRecord(
      z.enum(stepIds),
      z.object({ answer: answer.nullable(), note: text(1000).default(''), evidenceIds: idList.default([]) }),
    ),
    rationale: text(4000).pipe(z.string().min(20, 'Record a rationale of at least 20 characters')),
    confidence,
    unresolved: text(2000).default(''),
    nextAction: text(500).default(''),
    nextActionOwnerId: id.nullable().default(null),
    nextActionDue: instant.nullable().default(null),
  })

  app.post('/api/cases/:id/determinations', async (c) => {
    const user = requirePermission(c, 'determination.record')
    const theCase = loadCaseForWrite(db, user, c.req.param('id'))
    const input = await parseBody(c, determinationSchema)
    const bundle = loadBundle(db, theCase.id)!
    const product = bundle.products.find((p) => p.id === input.productId)
    if (!product) throw invalid('Product not in case', `${input.productId} is not part of ${theCase.id}.`)
    const answers = {} as Record<AffectednessStepId, StepAnswer>
    for (const s of STEPS) answers[s.id] = input.answers[s.id] ?? { answer: null, note: '', evidenceIds: [] }
    const allEvidence = [...new Set(Object.values(answers).flatMap((a) => a.evidenceIds))]
    assertEvidenceInCase(new Set(bundle.evidence.map((e) => e.id)), allEvidence)

    // The server computes the result. A client-supplied result is never read.
    const evaluation = evaluateAffectedness(answers)
    const fields: Record<string, string> = {}
    if (input.confidence !== 'HIGH' && input.unresolved.length < 10) fields.unresolved = 'Explain what remains unresolved at this confidence level'
    if (evaluation.result === 'UNDER_INVESTIGATION') {
      if (input.nextAction.length < 5) fields.nextAction = 'An under-investigation determination needs a next action'
      if (!input.nextActionOwnerId) fields.nextActionOwnerId = 'Assign an owner for the next action'
      if (!input.nextActionDue) fields.nextActionDue = 'Set a due time for the next action'
    }
    if (input.nextActionOwnerId && !getUser(db, input.nextActionOwnerId)) fields.nextActionOwnerId = 'Unknown user'
    if (Object.keys(fields).length) throw invalid('Determination incomplete', Object.values(fields)[0]!, fields)

    const previous = currentDeterminations(bundle).get(product.id) ?? null
    const pc = bundle.productComponents.find((x) => x.productId === product.id && x.componentId === bundle.vulnerability.componentId) ?? null
    const now = nowIso(deps)
    const det: Determination = {
      id: nextId(db, 'DET'),
      caseId: theCase.id,
      productId: product.id,
      productComponentId: pc?.id ?? null,
      answers,
      result: evaluation.result,
      vexStatus: evaluation.vexStatus,
      vexJustification: evaluation.justification,
      rationale: input.rationale,
      analystId: user.id,
      recordedAt: now,
      confidence: input.confidence,
      unresolved: input.unresolved,
      nextAction: input.nextAction,
      nextActionOwnerId: input.nextActionOwnerId,
      nextActionDue: input.nextActionDue,
      supersedesId: previous?.id ?? null,
    }
    tx(db, () => {
      insertDetermination(db, det)
      for (const e of allEvidence) insertLink(db, { evidenceId: e, targetType: 'determination', targetId: det.id }, now, user.id)
      appendAudit(db, {
        actorId: user.id,
        actorRole: user.role,
        eventType: 'DETERMINATION_RECORDED',
        objectType: 'determination',
        objectId: det.id,
        caseId: theCase.id,
        source: 'ui',
        summary: `${det.id} ${product.name}: ${det.result.replace(/_/g, ' ')}${previous && previous.result !== det.result ? ` (was ${previous.result.replace(/_/g, ' ')})` : ''}`,
        payload: {
          determinationId: det.id,
          productId: product.id,
          result: det.result,
          vexStatus: det.vexStatus,
          justification: det.vexJustification,
          confidence: det.confidence,
          supersedes: det.supersedesId,
        },
        at: now,
      })
      if (!previous || previous.result !== det.result) {
        notify(deps, {
          userIds: [theCase.ownerId, ...(det.nextActionOwnerId ? [det.nextActionOwnerId] : [])],
          exclude: user.id,
          kind: 'determination_recorded',
          severity: det.result === 'AFFECTED' ? 'watch' : 'info',
          title: `${product.name}: ${det.result.replace(/_/g, ' ').toLowerCase()} -- ${theCase.id}`,
          body: det.result === 'UNDER_INVESTIGATION' ? `Next action: ${det.nextAction}` : det.rationale.slice(0, 160),
          caseId: theCase.id,
          link: `/cases/${theCase.id}?tab=products`,
        })
      }
    })
    return c.json({ id: det.id, result: det.result, evaluation }, 201)
  })

  // Decisions -----------------------------------------------------------------
  const decisionSchema = z.object({
    outcome: z.enum(['REPORT', 'DO_NOT_REPORT']),
    nonReportReason: z.enum(['NOT_AFFECTED', 'NO_ACTIVE_EXPLOITATION', 'TRANSITIONAL_PRE_APPLICATION', 'NOT_MADE_AVAILABLE_IN_EU', 'OTHER']).nullable().default(null),
    rationale: text(6000).pipe(z.string().min(40, 'A decision rationale needs at least 40 characters')),
    confidence,
    unresolved: text(2000).default(''),
    evidenceIds: idList.default([]),
    divergenceReason: text(2000).nullable().default(null),
    exploitationBasis: text(2000).default(''),
  })

  app.post('/api/cases/:id/decisions', async (c) => {
    const user = requirePermission(c, 'decision.record')
    const theCase = loadCaseForWrite(db, user, c.req.param('id'))
    const input = await parseBody(c, decisionSchema)
    const bundle = loadBundle(db, theCase.id)!
    const analysis = analyze(deps, bundle)
    const suggestion = analysis.suggestion
    assertEvidenceInCase(new Set(bundle.evidence.map((e) => e.id)), input.evidenceIds)

    const fields: Record<string, string> = {}
    const diverges = suggestion.outcome !== input.outcome
    if (diverges && (!input.divergenceReason || input.divergenceReason.length < 20)) {
      fields.divergenceReason =
        suggestion.outcome === 'PENDING'
          ? 'The rule evaluation is still pending. Explain why the decision is recorded now (at least 20 characters)'
          : `The rule evaluation suggests ${suggestion.outcome.replace(/_/g, ' ')}. Record why this decision differs (at least 20 characters)`
    }
    if (input.confidence !== 'HIGH' && input.unresolved.length < 10) fields.unresolved = 'Explain what remains unresolved at this confidence level'
    if (input.outcome === 'DO_NOT_REPORT') {
      // A decision not to report is the higher-risk decision. It needs the
      // same record as a decision to report -- more, not less.
      if (!input.nonReportReason) fields.nonReportReason = 'Select the reason reporting is not required'
      const missingDets = bundle.products.filter((p) => !analysis.determinations[p.id])
      if (missingDets.length) fields.affectedness = `Record an affectedness determination for ${missingDets.map((p) => p.name).join(', ')}`
      if (bundle.vulnerability.exploitation === 'UNKNOWN') fields.exploitation = 'Assess exploitation before deciding not to report'
      if (!analysis.clock.vulnerabilityAwareness && !analysis.clock.exploitationAwareness) fields.awareness = 'Record the awareness event this decision rests on'
      if (input.evidenceIds.length === 0) fields.evidenceIds = 'Link at least one item of supporting evidence'
    }
    if (Object.keys(fields).length) {
      throw invalid(input.outcome === 'DO_NOT_REPORT' ? 'Non-report decision incomplete' : 'Decision incomplete', Object.values(fields)[0]!, fields)
    }

    const previous = currentDecision(bundle)
    const now = nowIso(deps)
    const awarenessIds = [analysis.clock.vulnerabilityAwareness?.original.id, analysis.clock.exploitationAwareness?.original.id].filter((x): x is string => !!x)
    const decision: Decision = {
      id: nextId(db, 'DEC'),
      caseId: theCase.id,
      outcome: input.outcome,
      nonReportReason: input.outcome === 'DO_NOT_REPORT' ? input.nonReportReason : null,
      suggestedOutcome: suggestion.outcome,
      divergenceReason: diverges ? input.divergenceReason : null,
      affectednessResult: suggestion.aggregateAffectedness,
      determinationIds: Object.values(analysis.determinations).map((d) => d.id),
      exploitation: bundle.vulnerability.exploitation,
      exploitationBasis: input.exploitationBasis,
      awarenessEventIds: awarenessIds,
      ruleSetVersion: analysis.ruleTrace.ruleSetVersion,
      ruleTrace: analysis.ruleTrace,
      rationale: input.rationale,
      analystId: user.id,
      decidedAt: now,
      confidence: input.confidence,
      unresolved: input.unresolved,
      evidenceIds: input.evidenceIds,
      supersedesId: previous?.id ?? null,
    }
    const eventBase: Omit<ClockEvent, 'integrityHash'> = {
      id: nextId(db, 'CE'),
      caseId: theCase.id,
      type: 'DECISION',
      occurredAt: now,
      timezone: 'UTC',
      actorId: user.id,
      source: 'NEXUS server clock (decision recorded)',
      sourceKind: 'nexus_server',
      evidenceIds: [],
      criterionId: null,
      responsibleRole: null,
      supersedesId: null,
      correctionReason: null,
      decisionId: decision.id,
      reportId: null,
      note: '',
      recordedAt: now,
    }
    const event: ClockEvent = { ...eventBase, integrityHash: recordHash(eventBase) }
    let recordId: string | null = null
    tx(db, () => {
      insertDecision(db, decision)
      insertEvent(db, event)
      for (const e of input.evidenceIds) insertLink(db, { evidenceId: e, targetType: 'decision', targetId: decision.id }, now, user.id)
      appendAudit(db, {
        actorId: user.id,
        actorRole: user.role,
        eventType: 'DECISION_RECORDED',
        objectType: 'decision',
        objectId: decision.id,
        caseId: theCase.id,
        source: 'ui',
        summary: `${decision.id}: ${decision.outcome === 'REPORT' ? 'REPORT' : 'REPORTING NOT REQUIRED'}${diverges ? ` (diverges from suggested ${suggestion.outcome})` : ''}`,
        payload: {
          decisionId: decision.id,
          outcome: decision.outcome,
          nonReportReason: decision.nonReportReason,
          suggestedOutcome: decision.suggestedOutcome,
          ruleSetVersion: decision.ruleSetVersion,
          clockEventId: event.id,
          supersedes: decision.supersedesId,
        },
        at: now,
      })
      if (decision.outcome === 'DO_NOT_REPORT') {
        const fresh = loadBundle(db, theCase.id)!
        const record = generateReport(deps, user, fresh, 'DECISION_RECORD')
        recordTransition(deps, { id: user.id, role: user.role }, record, 'INTERNAL_REVIEW', 'Decision record submitted for review automatically.')
        recordId = record.id
        notify(deps, {
          roles: ['compliance_reviewer', 'legal_reviewer'],
          exclude: user.id,
          kind: 'review_required',
          severity: 'watch',
          title: `Non-report decision requires review -- ${theCase.id}`,
          body: `${decision.id}: reporting not required (${decision.nonReportReason?.replace(/_/g, ' ').toLowerCase()}). Decision record ${record.id} is in internal review.`,
          caseId: theCase.id,
          link: `/cases/${theCase.id}?tab=report`,
        })
      } else {
        notify(deps, {
          userIds: [theCase.ownerId],
          roles: ['psirt_lead'],
          exclude: user.id,
          kind: 'decision_recorded',
          severity: 'critical',
          title: `Decision to report -- ${theCase.id}`,
          body: 'Generate and approve the early warning before its deadline.',
          caseId: theCase.id,
          link: `/cases/${theCase.id}?tab=report`,
        })
      }
    })
    return c.json({ id: decision.id, clockEventId: event.id, decisionRecordId: recordId }, 201)
  })

  // Comments --------------------------------------------------------------------
  const MENTION_ROLES: Record<string, RoleId[]> = {
    PSIRT: ['psirt_lead', 'psirt_analyst'],
    COMPLIANCE: ['compliance_reviewer'],
    SECURITYLEAD: ['security_manager', 'psirt_lead'],
    LEGAL: ['legal_reviewer'],
    EXECUTIVE: ['executive_approver'],
  }

  app.post('/api/cases/:id/comments', async (c) => {
    const user = requirePermission(c, 'comment.write')
    const theCase = assertCaseOpen(loadCaseForRead(db, c.req.param('id')))
    const input = await parseBody(
      c,
      z.object({
        body: text(4000).pipe(z.string().min(1, 'Write a comment')),
        relatedEventId: id.nullable().default(null),
        relatedEvidenceId: id.nullable().default(null),
      }),
    )
    const bundle = loadBundle(db, theCase.id)!
    if (input.relatedEventId && !bundle.events.some((e) => e.id === input.relatedEventId)) throw invalid('Unknown event', `${input.relatedEventId} is not in this case.`)
    if (input.relatedEvidenceId && !bundle.evidence.some((e) => e.id === input.relatedEvidenceId)) throw invalid('Unknown evidence', `${input.relatedEvidenceId} is not in this case.`)
    const mentions = [...new Set([...input.body.matchAll(/@([A-Za-z]+)/g)].map((m) => m[1]!.toUpperCase()).filter((m) => MENTION_ROLES[m]))]
    const comment: Comment = {
      id: nextId(db, 'CMT'),
      caseId: theCase.id,
      authorId: user.id,
      body: input.body,
      createdAt: nowIso(deps),
      relatedEventId: input.relatedEventId,
      relatedEvidenceId: input.relatedEvidenceId,
      mentions,
    }
    // Comments are collaboration, not history: stored separately, not in the ledger.
    tx(db, () => {
      insertComment(db, comment)
      if (mentions.length) {
        notify(deps, {
          roles: mentions.flatMap((m) => MENTION_ROLES[m]!),
          exclude: user.id,
          kind: 'mention',
          severity: 'info',
          title: `${user.name} mentioned ${mentions.map((m) => '@' + m.charAt(0) + m.slice(1).toLowerCase()).join(', ')} on ${theCase.id}`,
          body: input.body.slice(0, 200),
          caseId: theCase.id,
          link: `/cases/${theCase.id}?tab=overview`,
        })
      }
    })
    return c.json({ id: comment.id }, 201)
  })

  // Relations -------------------------------------------------------------------
  app.post('/api/cases/:id/relations', async (c) => {
    const user = requirePermission(c, 'case.edit')
    const theCase = loadCaseForWrite(db, user, c.req.param('id'))
    const input = await parseBody(
      c,
      z.object({
        relatedCaseId: id,
        relation: z.enum(['RELATED_CVE', 'RELATED_PRODUCT', 'RELATED_ADVISORY', 'RELATED_INCIDENT', 'RELATED_CORRECTIVE_MEASURE', 'DUPLICATE_OF']),
        note: text(1000).default(''),
      }),
    )
    if (input.relatedCaseId === theCase.id) throw invalid('Invalid relation', 'A case cannot be related to itself.')
    loadCaseForRead(db, input.relatedCaseId)
    const exists = listRelations(db, theCase.id).some((r) => r.caseId === input.relatedCaseId || r.relatedCaseId === input.relatedCaseId)
    if (exists) throw conflict('RELATION_EXISTS', 'Already related', `${theCase.id} and ${input.relatedCaseId} are already related.`)
    const rel: CaseRelation = {
      id: nextId(db, 'REL'),
      caseId: theCase.id,
      relatedCaseId: input.relatedCaseId,
      relation: input.relation,
      note: input.note,
      createdBy: user.id,
      createdAt: nowIso(deps),
    }
    tx(db, () => {
      insertRelation(db, rel)
      appendAudit(db, {
        actorId: user.id,
        actorRole: user.role,
        eventType: 'CASE_RELATION_ADDED',
        objectType: 'case_relation',
        objectId: rel.id,
        caseId: theCase.id,
        source: 'ui',
        summary: `${theCase.id} ${rel.relation.replace(/_/g, ' ').toLowerCase()} ${rel.relatedCaseId}`,
        payload: { relationId: rel.id, relatedCaseId: rel.relatedCaseId, relation: rel.relation },
        at: rel.createdAt,
      })
    })
    return c.json({ id: rel.id }, 201)
  })

  // Review marker ("what changed since last review") -------------------------------
  app.post('/api/cases/:id/reviewed', (c) => {
    const user = requireUser(c)
    const theCase = loadCaseForRead(db, c.req.param('id'))
    const head = db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM audit_events').get() as { seq: number }
    db.prepare(
      'INSERT INTO case_review_markers(user_id, case_id, reviewed_at, ledger_seq) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, case_id) DO UPDATE SET reviewed_at = excluded.reviewed_at, ledger_seq = excluded.ledger_seq',
    ).run(user.id, theCase.id, nowIso(deps), head.seq)
    return c.json({ ok: true })
  })

  // Users (directory for assignment pickers) ------------------------------------------
  app.get('/api/users', (c) => {
    requireUser(c)
    return c.json({ users: listUsers(db) })
  })
}
