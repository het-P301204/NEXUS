import type {
  AffectednessStepId,
  Answer,
  AwarenessCriterion,
  Case,
  CaseRelationType,
  ClockEvent,
  Comment,
  Confidence,
  Decision,
  DecisionOutcome,
  Determination,
  EvidenceClassification,
  EvidenceType,
  EscalationRule,
  NonReportReason,
  Organization,
  Product,
  ReportKind,
  ReviewAction,
  StepAnswer,
  SubmissionStage,
  TimestampSourceKind,
  User,
  Vulnerability,
  Component,
  ProductComponent,
  Deployment,
  ExploitationStatus,
} from '../types/domain.ts'
import { STEPS, evaluateAffectedness } from '../lib/engine/affectedness.ts'
import { currentDecision, currentDeterminations } from '../lib/engine/bundle.ts'
import type { Config } from './config.ts'
import type { Deps } from './context.ts'
import type { Db } from './db.ts'
import { nextId, setMeta, tx } from './db.ts'
import { recordHash, sha256Hex } from './hash.ts'
import { appendAudit, cacheVerification, verifyLedger } from './ledger.ts'
import { hashPassword } from './auth.ts'
import { storeObject } from './evidence-store.ts'
import {
  getVulnerability,
  insertCase,
  insertComment,
  insertComponent,
  insertDecision,
  insertDeployment,
  insertDetermination,
  insertEvent,
  insertEvidence,
  insertJson,
  insertLink,
  insertProduct,
  insertProductComponent,
  insertRelation,
  insertThreatIntel,
  insertVulnerability,
  loadBundle,
  updateCase,
  updateVulnerability,
  getCase,
} from './repo.ts'
import { analyze, notify } from './services.ts'
import type { NotifyInput } from './services.ts'
import { applyReview, currentReport, generateReport, recordSubmission, recordTransition } from './reporting.ts'

/**
 * The seeder replays a script of timestamped actions in chronological order,
 * with the clock set to each action's time. Records, ledger entries and
 * notifications therefore carry the times they would have carried had the
 * actions been taken through the UI, and the ledger's sequence order matches
 * its time order.
 *
 * Symbolic keys ("c1.advisory") stand in for ids, which are assigned at
 * replay time by the same sequences the API uses.
 */

export interface SeederOptions {
  db: Db
  config: Config
  now: Date
  source?: 'system' | 'demo'
  /**
   * Offset each clock event's recording by a few seconds, so seeded recordedAt
   * values do not all share one seconds value. Only safe when actions are
   * minutes apart: the scenario simulator writes its actions 50 ms apart, and
   * an offset there would record a decision before the awareness it rests on.
   */
  recordingJitter?: boolean
}

type T = number
type AnswerSpec = [Answer | null, string, string[]?]

/** Deterministic 0-58 second offset from a key, so seeded times do not all share one seconds value. */
function jitter(key: string): number {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619)
  return ((h >>> 0) % 59) * 1000
}

export function createSeeder(opts: SeederOptions) {
  const { db, config } = opts
  let clock = opts.now.getTime()
  const deps: Deps = { db, config, now: () => new Date(clock) }
  const actions: Array<{ t: T; order: number; run: () => void }> = []
  const refs = new Map<string, string>()
  const users = new Map<string, User>()
  let order = 0
  const source = opts.source ?? 'system'

  const schedule = (t: T, run: () => void) => actions.push({ t, order: order++, run })
  const ref = (key: string): string => {
    const v = refs.get(key)
    if (!v) throw new Error(`seed: unresolved reference "${key}"`)
    return v
  }
  const iso = (t: T) => new Date(t).toISOString()
  const user = (id: string) => {
    const u = users.get(id)
    if (!u) throw new Error(`seed: unknown user ${id}`)
    return u
  }
  const audit = (actorId: string, eventType: string, objectType: string, objectId: string, caseId: string | null, summary: string, payload: Record<string, unknown> = {}) => {
    const u = actorId === 'system' ? null : user(actorId)
    appendAudit(db, {
      actorId,
      actorRole: u?.role ?? 'system',
      eventType,
      objectType,
      objectId,
      caseId,
      source: source === 'demo' ? 'demo' : u ? 'ui' : 'system',
      summary,
      payload,
      at: iso(clock),
    })
  }

  return {
    deps,
    ref,
    refs,

    org(o: Organization) {
      insertJson(db, 'organization', { id: o.id }, o)
    },

    users(list: User[], demoPassword: string | null) {
      for (const u of list) {
        users.set(u.id, u)
        db.prepare('INSERT INTO users(id, email, role, password_hash, data) VALUES (?, ?, ?, ?, ?)').run(
          u.id,
          u.email.toLowerCase(),
          u.role,
          demoPassword ? hashPassword(demoPassword) : null,
          JSON.stringify(u),
        )
      }
    },

    knownUsers(list: User[]) {
      for (const u of list) users.set(u.id, u)
    },

    criteria(list: AwarenessCriterion[]) {
      for (const k of list) db.prepare('INSERT INTO criteria(id, data) VALUES (?, ?)').run(k.id, JSON.stringify(k))
    },

    escalation(list: EscalationRule[]) {
      for (const r of list) db.prepare('INSERT INTO escalation_rules(id, data) VALUES (?, ?)').run(r.id, JSON.stringify(r))
    },

    portfolio(t: T, data: { products: Product[]; components: Component[]; productComponents: ProductComponent[]; deployments: Deployment[] }, actorId: string) {
      schedule(t, () => {
        for (const c of data.components) insertComponent(db, c)
        for (const p of data.products) insertProduct(db, p)
        for (const pc of data.productComponents) insertProductComponent(db, pc)
        for (const d of data.deployments) insertDeployment(db, d)
        audit(actorId, 'PORTFOLIO_LOADED', 'portfolio', 'portfolio', null, `Product portfolio loaded: ${data.products.length} products, ${data.components.length} components, ${data.productComponents.length} SBOM mappings`, {
          products: data.products.map((p) => p.id),
        })
      })
    },

    vulnerability(key: string, t: T, v: Omit<Vulnerability, 'id' | 'createdAt' | 'createdBy'>, actorId: string) {
      schedule(t, () => {
        const full: Vulnerability = { ...v, id: nextId(db, 'VUL'), createdAt: iso(clock), createdBy: actorId }
        insertVulnerability(db, full)
        refs.set(key, full.id)
        audit(actorId, 'VULNERABILITY_ADDED', 'vulnerability', full.id, null, `${full.cve ?? full.id} added: ${full.title}`, { vulnerabilityId: full.id, cve: full.cve, severity: full.severity })
      })
    },

    exploitation(t: T, vulnKey: string, status: ExploitationStatus, actorId: string, caseKey: string | null) {
      schedule(t, () => {
        const v = getVulnerability(db, ref(vulnKey))!
        updateVulnerability(db, { ...v, exploitation: status })
        audit(actorId, 'VULNERABILITY_EXPLOITATION_UPDATED', 'vulnerability', v.id, caseKey ? ref(caseKey) : null, `${v.cve ?? v.id} exploitation ${v.exploitation} -> ${status}`, { from: v.exploitation, to: status })
      })
    },

    intel(t: T, vulnKey: string, spec: { source: string; observed: boolean; firstObserved: T | null; confidence: Confidence; indicator: string; reference: string; analystId: string }) {
      schedule(t, () => {
        const id = nextId(db, 'TI')
        insertThreatIntel(db, {
          id,
          vulnerabilityId: ref(vulnKey),
          source: spec.source,
          observedExploitation: spec.observed,
          firstObserved: spec.firstObserved === null ? null : iso(spec.firstObserved),
          confidence: spec.confidence,
          indicator: spec.indicator,
          reference: spec.reference,
          analystId: spec.analystId,
          recordedAt: iso(clock),
        })
        audit(spec.analystId, 'THREAT_INTEL_RECORDED', 'threat_intel', id, null, `${id}: ${spec.observed ? 'exploitation observed' : 'no exploitation observed'} (${spec.source})`, { observedExploitation: spec.observed })
      })
    },

    openCase(key: string, t: T, spec: { title: string; vulnKey: string; productIds: string[]; ownerId: string; createdBy: string; collaboratorIds?: string[]; tags?: string[]; summary: string }) {
      schedule(t, () => {
        const c: Case = {
          id: nextId(db, `CASE-${iso(clock).slice(0, 4)}`),
          title: spec.title,
          vulnerabilityId: ref(spec.vulnKey),
          ownerId: spec.ownerId,
          collaboratorIds: spec.collaboratorIds ?? [],
          tags: spec.tags ?? [],
          lifecycle: 'open',
          lifecycleReason: null,
          productIds: spec.productIds,
          createdAt: iso(clock),
          createdBy: spec.createdBy,
          summary: spec.summary,
        }
        insertCase(db, c)
        refs.set(key, c.id)
        const v = getVulnerability(db, c.vulnerabilityId)!
        audit(spec.createdBy, 'CASE_CREATED', 'case', c.id, c.id, `${c.id} opened for ${v.cve ?? v.id}`, { vulnerabilityId: v.id, productIds: c.productIds, ownerId: c.ownerId })
      })
    },

    evidence(
      key: string,
      t: T,
      spec: {
        caseKey: string
        type: EvidenceType
        title: string
        description: string
        source: string
        sourceCreatedAt: T | null
        ownerId: string
        classification?: EvidenceClassification
        fileName: string
        content: string
        links?: Array<{ targetType: 'vulnerability' | 'case'; key: string }>
      },
    ) {
      schedule(t, () => {
        const bytes = new TextEncoder().encode(spec.content)
        const sha = sha256Hex(bytes)
        storeObject(config.evidenceDir, sha, bytes)
        const caseId = ref(spec.caseKey)
        const isJson = spec.fileName.endsWith('.json')
        const id = nextId(db, 'EV')
        insertEvidence(db, {
          id,
          caseId,
          type: spec.type,
          title: spec.title,
          description: spec.description,
          source: spec.source,
          sourceCreatedAt: spec.sourceCreatedAt === null ? null : iso(spec.sourceCreatedAt),
          uploadedAt: iso(clock),
          ownerId: spec.ownerId,
          classification: spec.classification ?? 'internal',
          sha256: sha,
          fileName: spec.fileName,
          mimeType: isJson ? 'application/json' : 'text/plain',
          sizeBytes: bytes.length,
          hasFile: true,
        })
        refs.set(key, id)
        for (const l of spec.links ?? []) insertLink(db, { evidenceId: id, targetType: l.targetType, targetId: ref(l.key) }, iso(clock), spec.ownerId)
        audit(spec.ownerId, 'EVIDENCE_ADDED', 'evidence', id, caseId, `${id} ${spec.type.replace(/_/g, ' ').toLowerCase()} added${spec.classification === 'restricted' ? ' (restricted)' : ''}`, {
          evidenceId: id,
          type: spec.type,
          sha256: sha,
          sizeBytes: bytes.length,
          classification: spec.classification ?? 'internal',
        })
      })
    },

    event(
      key: string,
      t: T,
      spec: {
        caseKey: string
        type: 'OCCURRENCE' | 'DETECTION' | 'VULNERABILITY_AWARENESS' | 'EXPLOITATION_AWARENESS' | 'MEASURE_AVAILABLE'
        occurredAt: T
        timezone: string
        actorId: string
        source: string
        sourceKind: TimestampSourceKind
        evidenceKeys?: string[]
        criterionId?: string
        note?: string
      },
    ) {
      // Relative times get a per-event seconds offset; absolute ones (whole minutes) are kept.
      const occurred = spec.occurredAt % 60_000 === 0 ? spec.occurredAt : spec.occurredAt - jitter(key)
      schedule(t + (opts.recordingJitter === false ? 0 : jitter(`${key}:r`)), () => {
        const caseId = ref(spec.caseKey)
        const awareness = spec.type === 'VULNERABILITY_AWARENESS' || spec.type === 'EXPLOITATION_AWARENESS'
        const evidenceIds = (spec.evidenceKeys ?? []).map(ref)
        const criterion = spec.criterionId ? (JSON.parse((db.prepare('SELECT data FROM criteria WHERE id = ?').get(spec.criterionId) as { data: string }).data) as AwarenessCriterion) : null
        const base: Omit<ClockEvent, 'integrityHash'> = {
          id: nextId(db, 'CE'),
          caseId,
          type: spec.type,
          occurredAt: iso(occurred),
          timezone: spec.timezone,
          actorId: spec.actorId,
          source: spec.source,
          sourceKind: spec.sourceKind,
          evidenceIds,
          criterionId: awareness ? (spec.criterionId ?? null) : null,
          responsibleRole: criterion?.responsibleRole ?? null,
          supersedesId: null,
          correctionReason: null,
          decisionId: null,
          reportId: null,
          note: spec.note ?? '',
          recordedAt: iso(clock),
        }
        const e: ClockEvent = { ...base, integrityHash: recordHash(base) }
        insertEvent(db, e)
        refs.set(key, e.id)
        for (const id of evidenceIds) insertLink(db, { evidenceId: id, targetType: 'clock_event', targetId: e.id }, iso(clock), spec.actorId)
        audit(spec.actorId, awareness ? 'AWARENESS_ESTABLISHED' : 'CLOCK_EVENT_RECORDED', 'clock_event', e.id, caseId, `${e.id} ${spec.type.replace(/_/g, ' ').toLowerCase()} at ${e.occurredAt}`, {
          eventId: e.id,
          type: e.type,
          occurredAt: e.occurredAt,
          sourceKind: e.sourceKind,
          integrityHash: e.integrityHash,
          criterionId: e.criterionId,
        })
        if (awareness) {
          const c = getCase(db, caseId)!
          notify(deps, {
            userIds: [c.ownerId],
            roles: ['psirt_lead', 'security_manager'],
            exclude: spec.actorId,
            kind: 'awareness_established',
            severity: spec.type === 'EXPLOITATION_AWARENESS' ? 'critical' : 'watch',
            title: `${spec.type === 'EXPLOITATION_AWARENESS' ? 'Exploitation' : 'Vulnerability'} awareness established -- ${caseId}`,
            body: spec.type === 'EXPLOITATION_AWARENESS' ? 'Reporting clock started. Early warning due within 24 hours of awareness.' : `${e.id} recorded against criterion ${spec.criterionId}.`,
            caseId,
            link: `/cases/${caseId}?tab=clock`,
          })
        }
      })
    },

    correction(key: string, t: T, spec: { caseKey: string; targetKey: string; occurredAt: T; timezone: string; actorId: string; source: string; sourceKind: TimestampSourceKind; reason: string; evidenceKeys?: string[] }) {
      schedule(t, () => {
        const caseId = ref(spec.caseKey)
        const target = loadBundle(db, caseId)!.events.find((e) => e.id === ref(spec.targetKey))!
        const evidenceIds = (spec.evidenceKeys ?? []).map(ref)
        const base: Omit<ClockEvent, 'integrityHash'> = {
          id: nextId(db, 'CE'),
          caseId,
          type: 'CORRECTION',
          occurredAt: iso(spec.occurredAt),
          timezone: spec.timezone,
          actorId: spec.actorId,
          source: spec.source,
          sourceKind: spec.sourceKind,
          evidenceIds,
          criterionId: target.criterionId,
          responsibleRole: target.responsibleRole,
          supersedesId: target.id,
          correctionReason: spec.reason,
          decisionId: null,
          reportId: null,
          note: '',
          recordedAt: iso(clock),
        }
        const e: ClockEvent = { ...base, integrityHash: recordHash(base) }
        insertEvent(db, e)
        refs.set(key, e.id)
        for (const id of evidenceIds) insertLink(db, { evidenceId: id, targetType: 'clock_event', targetId: e.id }, iso(clock), spec.actorId)
        audit(spec.actorId, 'CLOCK_EVENT_CORRECTED', 'clock_event', e.id, caseId, `${e.id} corrects ${target.id} (${target.type.replace(/_/g, ' ').toLowerCase()}): ${target.occurredAt} -> ${e.occurredAt}`, {
          correctionId: e.id,
          supersedes: target.id,
          rootType: target.type,
          from: target.occurredAt,
          to: e.occurredAt,
          reason: spec.reason,
          integrityHash: e.integrityHash,
        })
      })
    },

    determination(
      key: string,
      t: T,
      spec: {
        caseKey: string
        productId: string
        analystId: string
        answers: Partial<Record<AffectednessStepId, AnswerSpec>>
        rationale: string
        confidence: Confidence
        unresolved?: string
        nextAction?: string
        nextActionOwnerId?: string
        nextActionDue?: T
      },
    ) {
      schedule(t, () => {
        const caseId = ref(spec.caseKey)
        const bundle = loadBundle(db, caseId)!
        const answers = {} as Record<AffectednessStepId, StepAnswer>
        for (const s of STEPS) {
          const a = spec.answers[s.id]
          answers[s.id] = a ? { answer: a[0], note: a[1], evidenceIds: (a[2] ?? []).map(ref) } : { answer: null, note: '', evidenceIds: [] }
        }
        const evaluation = evaluateAffectedness(answers)
        const previous = currentDeterminations(bundle).get(spec.productId) ?? null
        const pc = bundle.productComponents.find((x) => x.productId === spec.productId && x.componentId === bundle.vulnerability.componentId) ?? null
        const d: Determination = {
          id: nextId(db, 'DET'),
          caseId,
          productId: spec.productId,
          productComponentId: pc?.id ?? null,
          answers,
          result: evaluation.result,
          vexStatus: evaluation.vexStatus,
          vexJustification: evaluation.justification,
          rationale: spec.rationale,
          analystId: spec.analystId,
          recordedAt: iso(clock),
          confidence: spec.confidence,
          unresolved: spec.unresolved ?? '',
          nextAction: spec.nextAction ?? '',
          nextActionOwnerId: spec.nextActionOwnerId ?? null,
          nextActionDue: spec.nextActionDue ? iso(spec.nextActionDue) : null,
          supersedesId: previous?.id ?? null,
        }
        insertDetermination(db, d)
        refs.set(key, d.id)
        for (const id of new Set(Object.values(answers).flatMap((a) => a.evidenceIds))) insertLink(db, { evidenceId: id, targetType: 'determination', targetId: d.id }, iso(clock), spec.analystId)
        const product = bundle.products.find((p) => p.id === spec.productId)!
        audit(spec.analystId, 'DETERMINATION_RECORDED', 'determination', d.id, caseId, `${d.id} ${product.name}: ${d.result.replace(/_/g, ' ')}`, {
          determinationId: d.id,
          productId: d.productId,
          result: d.result,
          vexStatus: d.vexStatus,
          justification: d.vexJustification,
          confidence: d.confidence,
        })
      })
    },

    decision(
      key: string,
      t: T,
      spec: {
        caseKey: string
        analystId: string
        outcome: DecisionOutcome
        nonReportReason?: NonReportReason
        rationale: string
        confidence: Confidence
        unresolved?: string
        evidenceKeys?: string[]
        divergenceReason?: string
        exploitationBasis?: string
        recordKey?: string
      },
    ) {
      schedule(t, () => {
        const caseId = ref(spec.caseKey)
        const bundle = loadBundle(db, caseId)!
        const analysis = analyze(deps, bundle)
        const previous = currentDecision(bundle)
        const evidenceIds = (spec.evidenceKeys ?? []).map(ref)
        const d: Decision = {
          id: nextId(db, 'DEC'),
          caseId,
          outcome: spec.outcome,
          nonReportReason: spec.outcome === 'DO_NOT_REPORT' ? (spec.nonReportReason ?? 'OTHER') : null,
          suggestedOutcome: analysis.suggestion.outcome,
          divergenceReason: analysis.suggestion.outcome !== spec.outcome ? (spec.divergenceReason ?? null) : null,
          affectednessResult: analysis.suggestion.aggregateAffectedness,
          determinationIds: Object.values(analysis.determinations).map((x) => x.id),
          exploitation: bundle.vulnerability.exploitation,
          exploitationBasis: spec.exploitationBasis ?? '',
          awarenessEventIds: [analysis.clock.vulnerabilityAwareness?.original.id, analysis.clock.exploitationAwareness?.original.id].filter((x): x is string => !!x),
          ruleSetVersion: analysis.ruleTrace.ruleSetVersion,
          ruleTrace: analysis.ruleTrace,
          rationale: spec.rationale,
          analystId: spec.analystId,
          decidedAt: iso(clock),
          confidence: spec.confidence,
          unresolved: spec.unresolved ?? '',
          evidenceIds,
          supersedesId: previous?.id ?? null,
        }
        insertDecision(db, d)
        refs.set(key, d.id)
        const base: Omit<ClockEvent, 'integrityHash'> = {
          id: nextId(db, 'CE'),
          caseId,
          type: 'DECISION',
          occurredAt: iso(clock),
          timezone: 'UTC',
          actorId: spec.analystId,
          source: 'NEXUS server clock (decision recorded)',
          sourceKind: 'nexus_server',
          evidenceIds: [],
          criterionId: null,
          responsibleRole: null,
          supersedesId: null,
          correctionReason: null,
          decisionId: d.id,
          reportId: null,
          note: '',
          recordedAt: iso(clock),
        }
        const e: ClockEvent = { ...base, integrityHash: recordHash(base) }
        insertEvent(db, e)
        for (const id of evidenceIds) insertLink(db, { evidenceId: id, targetType: 'decision', targetId: d.id }, iso(clock), spec.analystId)
        audit(spec.analystId, 'DECISION_RECORDED', 'decision', d.id, caseId, `${d.id}: ${d.outcome === 'REPORT' ? 'REPORT' : 'REPORTING NOT REQUIRED'}`, {
          decisionId: d.id,
          outcome: d.outcome,
          nonReportReason: d.nonReportReason,
          suggestedOutcome: d.suggestedOutcome,
          ruleSetVersion: d.ruleSetVersion,
          clockEventId: e.id,
        })
        if (d.outcome === 'DO_NOT_REPORT') {
          const record = generateReport(deps, user(spec.analystId), loadBundle(db, caseId)!, 'DECISION_RECORD')
          recordTransition(deps, { id: spec.analystId, role: user(spec.analystId).role }, record, 'INTERNAL_REVIEW', 'Decision record submitted for review automatically.')
          if (spec.recordKey) refs.set(spec.recordKey, record.id)
          notify(deps, {
            roles: ['compliance_reviewer', 'legal_reviewer'],
            exclude: spec.analystId,
            kind: 'review_required',
            severity: 'watch',
            title: `Non-report decision requires review -- ${caseId}`,
            body: `${d.id}: reporting not required. Decision record ${record.id} is in internal review.`,
            caseId,
            link: `/cases/${caseId}?tab=report`,
          })
        } else {
          notify(deps, {
            userIds: [getCase(db, caseId)!.ownerId],
            roles: ['psirt_lead'],
            exclude: spec.analystId,
            kind: 'decision_recorded',
            severity: 'critical',
            title: `Decision to report -- ${caseId}`,
            body: 'Generate and approve the early warning before its deadline.',
            caseId,
            link: `/cases/${caseId}?tab=report`,
          })
        }
      })
    },

    report(key: string, t: T, spec: { caseKey: string; kind: ReportKind; userId: string }) {
      schedule(t, () => {
        const r = generateReport(deps, user(spec.userId), loadBundle(db, ref(spec.caseKey))!, spec.kind)
        refs.set(key, r.id)
      })
    },

    transition(t: T, reportKey: string, to: SubmissionStage, userId: string, note = '') {
      schedule(t, () => {
        const r = currentReport(deps, ref(reportKey))!
        recordTransition(deps, { id: userId, role: user(userId).role }, r, to, note)
      })
    },

    review(t: T, spec: { caseKey: string; reportKey: string; reviewerId: string; action: ReviewAction; comment: string }) {
      schedule(t, () => {
        const r = currentReport(deps, ref(spec.reportKey))!
        const u = user(spec.reviewerId)
        applyReview(
          deps,
          u,
          {
            id: nextId(db, 'REV'),
            caseId: ref(spec.caseKey),
            targetType: 'report',
            targetId: r.id,
            reviewerId: u.id,
            reviewerRole: u.role,
            action: spec.action,
            comment: spec.comment,
            createdAt: iso(clock),
          },
          r,
        )
      })
    },

    submit(t: T, reportKey: string, userId: string) {
      schedule(t, () => {
        const r = currentReport(deps, ref(reportKey))!
        const s = recordSubmission(deps, user(userId), r)
        recordTransition(deps, { id: userId, role: user(userId).role }, r, 'SUBMITTED', `Simulated submission ${s.reference}.`)
      })
    },

    comment(t: T, spec: { caseKey: string; authorId: string; body: string; relatedEventKey?: string; relatedEvidenceKey?: string }) {
      schedule(t, () => {
        const mentions = [...new Set([...spec.body.matchAll(/@([A-Za-z]+)/g)].map((m) => m[1]!.toUpperCase()))]
        const c: Comment = {
          id: nextId(db, 'CMT'),
          caseId: ref(spec.caseKey),
          authorId: spec.authorId,
          body: spec.body,
          createdAt: iso(clock),
          relatedEventId: spec.relatedEventKey ? ref(spec.relatedEventKey) : null,
          relatedEvidenceId: spec.relatedEvidenceKey ? ref(spec.relatedEvidenceKey) : null,
          mentions,
        }
        insertComment(db, c)
      })
    },

    relation(t: T, spec: { caseKey: string; relatedCaseKey: string; relation: CaseRelationType; note: string; userId: string }) {
      schedule(t, () => {
        const id = nextId(db, 'REL')
        const caseId = ref(spec.caseKey)
        insertRelation(db, { id, caseId, relatedCaseId: ref(spec.relatedCaseKey), relation: spec.relation, note: spec.note, createdBy: spec.userId, createdAt: iso(clock) })
        audit(spec.userId, 'CASE_RELATION_ADDED', 'case_relation', id, caseId, `${caseId} ${spec.relation.replace(/_/g, ' ').toLowerCase()} ${ref(spec.relatedCaseKey)}`, { relationId: id })
      })
    },

    lifecycle(t: T, caseKey: string, lifecycle: Case['lifecycle'], reason: string, userId: string) {
      schedule(t, () => {
        const c = getCase(db, ref(caseKey))!
        updateCase(db, { ...c, lifecycle, lifecycleReason: reason })
        audit(userId, 'CASE_LIFECYCLE_CHANGED', 'case', c.id, c.id, `${c.id} ${lifecycle === 'open' ? 'reopened' : lifecycle}: ${reason}`, { from: c.lifecycle, to: lifecycle, reason })
      })
    },

    markReviewed(t: T, userId: string, caseKey: string) {
      schedule(t, () => {
        const head = db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM audit_events').get() as { seq: number }
        db.prepare('INSERT OR REPLACE INTO case_review_markers(user_id, case_id, reviewed_at, ledger_seq) VALUES (?, ?, ?, ?)').run(userId, ref(caseKey), iso(clock), head.seq)
      })
    },

    notify(t: T, input: NotifyInput) {
      schedule(t, () => notify(deps, input))
    },

    auditOnly(t: T, actorId: string, eventType: string, summary: string, payload: Record<string, unknown> = {}) {
      schedule(t, () => audit(actorId, eventType, 'system', 'system', null, summary, payload))
    },

    /** Replay every scheduled action in time order, each in its own transaction. */
    async run(opts2: { verifyAt?: T; verifier?: string } = {}) {
      actions.sort((a, b) => a.t - b.t || a.order - b.order)
      for (const a of actions) {
        clock = a.t
        tx(db, a.run)
      }
      if (opts2.verifyAt !== undefined && opts2.verifier) {
        clock = opts2.verifyAt
        const result = await verifyLedger(db)
        tx(db, () => {
          cacheVerification(db, result, iso(clock), opts2.verifier!)
          audit(opts2.verifier!, result.ok ? 'LEDGER_VERIFIED' : 'LEDGER_INTEGRITY_EXCEPTION', 'ledger', 'audit_events', null, `Ledger integrity verified: ${result.checked} entries, head ${result.headHash.slice(0, 12)}`, {
            ok: result.ok,
            checked: result.checked,
            headSeq: result.headSeq,
            headHash: result.headHash,
          })
        })
      }
      clock = opts.now.getTime()
    },

    setMeta(k: string, v: string) {
      setMeta(db, k, v)
    },
  }
}

export type Seeder = ReturnType<typeof createSeeder>
