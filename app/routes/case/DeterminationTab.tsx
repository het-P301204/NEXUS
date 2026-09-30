import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { motion } from 'motion/react'
import { CircleSlash, Gavel, ShieldAlert, Hourglass } from 'lucide-react'
import type { Confidence, Decision, DecisionOutcome, NonReportReason } from '../../../types/domain.ts'
import { api, ApiFailure } from '../../../lib/client/api.ts'
import { useAction } from '../../../lib/client/queries.ts'
import { useSession } from '../../../lib/client/session.tsx'
import { short, stamp } from '../../../lib/client/format.ts'
import { NON_REPORT_REASON_LABELS } from '../../../lib/engine/reportability.ts'
import { RULE_SET } from '../../../rules/cra-article14.ts'
import { Button, Field, Ident, KeyValue, Segmented, Select, TextArea, cx } from '../../../components/ui/primitives.tsx'
import { AffectednessBadge, Badge, ExploitationBadge, StageBadge } from '../../../components/ui/status.tsx'
import { ErrorState, Notice } from '../../../components/ui/feedback.tsx'
import { Drawer, useToast } from '../../../components/ui/overlay.tsx'
import { Chrono } from '../../../components/ui/time.tsx'
import { RuleTrace } from '../../../components/reasoning/RuleTrace.tsx'
import { EvidencePicker } from '../../../components/reasoning/EvidencePicker.tsx'
import { EvidenceChips, SectionTitle, useCaseCtx } from './shared.tsx'

function Transitional() {
  const { data } = useCaseCtx()
  const t = data.analysis.transitional
  const side = (s: 'pre' | 'post' | 'unknown') =>
    s === 'pre' ? { label: 'Pre-11 September 2026', cls: 'text-ink-2 border-line-strong' } : s === 'post' ? { label: 'Post-11 September 2026', cls: 'text-amber border-amber-line' } : { label: 'Not recorded', cls: 'text-ink-4 border-line' }
  const va = side(t.vulnerabilitySide)
  const ea = side(t.exploitationSide)
  const result =
    t.result === 'APPLICABLE'
      ? { label: 'Applicable', tone: 'text-red' }
      : t.result === 'NOT_APPLICABLE_PRE_APPLICATION'
        ? { label: 'Not applicable', tone: 'text-ink' }
        : t.result === 'NO_EXPLOITATION_AWARENESS'
          ? { label: 'No exploitation awareness', tone: 'text-amber' }
          : { label: 'Indeterminate', tone: 'text-ink-3' }
  return (
    <section aria-labelledby="transitional-h" className="panel p-5 sm:p-6">
      <div className="micro mb-1.5">Transitional rule · Art. 71(2)</div>
      <h2 id="transitional-h" className="text-lg font-medium text-ink">
        Two awareness dates, evaluated independently
      </h2>
      <p className="mt-2 text-xs text-ink-3">
        Application instant <span className="mono text-ink-2">{stamp(t.applicationInstant, 'UTC')}</span> (00:00 CEST, 11 Sep 2026)
      </p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {[
          { label: 'Vulnerability awareness', at: t.vulnerabilityAwareAt, side: va },
          { label: 'Exploitation awareness', at: t.exploitationAwareAt, side: ea },
        ].map((x) => (
          <div key={x.label} className={cx('rounded-lg border px-4 py-3.5', x.side.cls)}>
            <div className="micro text-ink-3">{x.label}</div>
            <div className="mt-2">{x.at ? <Chrono iso={x.at} size="sm" /> : <span className="text-sm text-ink-4">Not recorded</span>}</div>
            <div className={cx('micro mt-2.5', x.side.cls.split(' ')[0])}>{x.side.label}</div>
          </div>
        ))}
      </div>
      <div className="mt-5 border-t border-line pt-4">
        <div className="micro">Applicability</div>
        <div className={cx('mt-1 text-xl font-medium uppercase tracking-[0.03em]', result.tone)}>{result.label}</div>
        {t.triggerInstant && (
          <div className="mono mt-1 text-xs text-ink-3">
            trigger (later of the two): {stamp(t.triggerInstant)}
          </div>
        )}
        <ul className="mt-3 space-y-1.5">
          {t.reasoning.map((r, i) => (
            <li key={i} className={cx('text-xs leading-relaxed', r.includes('Counsel review') ? 'text-amber' : 'text-ink-2')}>
              {r}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function DecisionRecord({ d, current }: { d: Decision; current: boolean }) {
  const { name, data } = useCaseCtx()
  const record = data.bundle.reports.filter((r) => r.kind === 'DECISION_RECORD' && r.decisionId === d.id).at(-1)
  const report = d.outcome === 'REPORT'
  return (
    <article className={cx('min-w-0 rounded-xl border p-5 sm:p-7', current ? (report ? 'border-red-line bg-red/[0.024]' : 'border-line-bright bg-s1') : 'border-line bg-transparent opacity-80')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="micro">
          Decision record <Ident className="ml-1 text-[11px]">{d.id}</Ident>
          {!current && <span className="ml-2 text-ink-4">superseded</span>}
        </div>
        {record && <StageBadge stage={record.stage} size="sm" />}
      </div>
      <div className="mt-5 flex items-start gap-4">
        {report ? <ShieldAlert className="mt-1 h-7 w-7 shrink-0 text-red" strokeWidth={1.5} /> : <CircleSlash className="mt-1 h-7 w-7 shrink-0 text-ink-2" strokeWidth={1.5} />}
        <div className="min-w-0">
          <div className="micro">Reportability</div>
          <div className={cx('mt-1 text-3xl font-medium uppercase tracking-[0.02em]', report ? 'text-red' : 'text-ink')}>{report ? 'Report' : 'Not required'}</div>
          {d.nonReportReason && <div className="mt-1 text-sm text-ink-2">Reason: {NON_REPORT_REASON_LABELS[d.nonReportReason]}</div>}
        </div>
      </div>
      <p className="mt-5 max-w-3xl whitespace-pre-wrap text-sm leading-relaxed text-ink">{d.rationale}</p>
      {d.divergenceReason && (
        <Notice tone="amber" title={`Diverges from rule evaluation (suggested ${d.suggestedOutcome.replace(/_/g, ' ').toLowerCase()})`} className="mt-4">
          {d.divergenceReason}
        </Notice>
      )}
      <dl className="mt-6 grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        <KeyValue label="Affectedness result">
          <AffectednessBadge result={d.affectednessResult} size="sm" />
        </KeyValue>
        <KeyValue label="Exploitation assessment">
          <span className="flex flex-col gap-1">
            <ExploitationBadge status={d.exploitation} size="sm" />
            {d.exploitationBasis && <span className="text-xs text-ink-3">{d.exploitationBasis}</span>}
          </span>
        </KeyValue>
        <KeyValue label="Awareness evidence" mono>
          {d.awarenessEventIds.length ? d.awarenessEventIds.join(', ') : 'none'}
        </KeyValue>
        <KeyValue label="Applicable rule" mono>
          {RULE_SET.id} {d.ruleSetVersion}
        </KeyValue>
        <KeyValue label="Suggested at the time">{d.suggestedOutcome.replace(/_/g, ' ')}</KeyValue>
        <KeyValue label="Confidence">
          <Badge tone={d.confidence === 'HIGH' ? 'green' : d.confidence === 'MEDIUM' ? 'amber' : 'red'} size="sm">
            {d.confidence} confidence
          </Badge>
        </KeyValue>
        <KeyValue label="Analyst">{name(d.analystId)}</KeyValue>
        <KeyValue label="Timestamp">
          <Chrono iso={d.decidedAt} size="sm" />
        </KeyValue>
        <KeyValue label="Determinations" mono>
          {d.determinationIds.join(', ') || 'none'}
        </KeyValue>
      </dl>
      {d.unresolved && (
        <div className="mt-5">
          <div className="micro mb-1">Unresolved at the time of decision</div>
          <p className="text-sm text-ink-2">{d.unresolved}</p>
        </div>
      )}
      <div className="mt-5">
        <div className="micro mb-2">Supporting evidence</div>
        <EvidenceChips ids={d.evidenceIds} />
      </div>
    </article>
  )
}

function ConfidencePanel() {
  const { data, name } = useCaseCtx()
  const d = data.analysis.decision
  const dets = Object.values(data.analysis.determinations)
  const open = dets.filter((x) => x.confidence !== 'HIGH' || x.result === 'UNDER_INVESTIGATION')
  const level: Confidence | null = d?.confidence ?? (open.length ? open.reduce<Confidence>((a, x) => (x.confidence === 'LOW' || a === 'LOW' ? 'LOW' : 'MEDIUM'), 'MEDIUM') : null)
  if (!level || (level === 'HIGH' && open.length === 0)) return null
  const tone = level === 'LOW' ? 'border-red-line text-red' : level === 'MEDIUM' ? 'border-amber-line text-amber' : 'border-green-line text-green'
  return (
    <section aria-label="Decision confidence" className={cx('rounded-xl border p-5 sm:p-6', tone.split(' ')[0])}>
      <div className={cx('micro', tone.split(' ')[1])}>{level} confidence</div>
      <p className="mt-2 max-w-3xl text-sm text-ink">{d?.unresolved || open[0]?.unresolved || 'Unresolved items remain.'}</p>
      <p className="mt-2 text-xs text-ink-3">Confidence is the analyst's statement of what remains unresolved. It is not a risk score.</p>
      {open.length > 0 && (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className="micro py-2 pr-4 font-normal">Evidence gap</th>
                <th className="micro py-2 pr-4 font-normal">Recommended next action</th>
                <th className="micro py-2 pr-4 font-normal">Owner</th>
                <th className="micro py-2 font-normal">Due</th>
              </tr>
            </thead>
            <tbody>
              {open.map((x) => (
                <tr key={x.id} className="border-b border-line last:border-0">
                  <td className="py-2.5 pr-4 align-top text-xs text-ink-2">
                    {data.bundle.products.find((p) => p.id === x.productId)?.name}: {data.analysis.evaluations[x.productId]?.headline}
                  </td>
                  <td className="py-2.5 pr-4 align-top text-xs text-ink">{x.nextAction || '--'}</td>
                  <td className="py-2.5 pr-4 align-top text-xs text-ink-2">{name(x.nextActionOwnerId)}</td>
                  <td className="mono py-2.5 align-top text-xs text-ink-2">{x.nextActionDue ? short(x.nextActionDue) : '--'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function RecordDecision({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data } = useCaseCtx()
  const toast = useToast()
  const s = data.analysis.suggestion
  const [outcome, setOutcome] = useState<DecisionOutcome>(s.outcome === 'DO_NOT_REPORT' ? 'DO_NOT_REPORT' : 'REPORT')
  const [reason, setReason] = useState<NonReportReason | ''>(s.nonReportReason ?? '')
  const [rationale, setRationale] = useState('')
  const [confidence, setConfidence] = useState<Confidence>('HIGH')
  const [unresolved, setUnresolved] = useState('')
  const [evidenceIds, setEvidenceIds] = useState<string[]>([])
  const [divergence, setDivergence] = useState('')
  const [basis, setBasis] = useState('')
  const [error, setError] = useState<unknown>(null)
  const record = useAction((b: unknown) => api<{ id: string; decisionRecordId: string | null }>(`/api/cases/${data.bundle.case.id}/decisions`, { body: b }))
  useEffect(() => {
    if (!open) return
    setOutcome(s.outcome === 'DO_NOT_REPORT' ? 'DO_NOT_REPORT' : 'REPORT')
    setReason(s.nonReportReason ?? '')
    setError(null)
  }, [open, s.outcome, s.nonReportReason])
  const diverges = s.outcome !== outcome
  const fields = error instanceof ApiFailure ? (error.body.fields ?? {}) : {}
  const submit = async () => {
    setError(null)
    try {
      const r = await record.mutateAsync({
        outcome,
        nonReportReason: outcome === 'DO_NOT_REPORT' ? reason || null : null,
        rationale,
        confidence,
        unresolved,
        evidenceIds,
        divergenceReason: diverges ? divergence : null,
        exploitationBasis: basis,
      })
      toast({
        tone: 'success',
        title: `Decision ${r.id} recorded`,
        body: r.decisionRecordId ? `Decision record ${r.decisionRecordId} sent to compliance and legal review.` : 'The DECISION event is on the Clock of Record. Generate the early warning next.',
      })
      onClose()
    } catch (e) {
      setError(e)
    }
  }
  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow={data.bundle.case.id}
      title="Record reportability decision"
      width="sm:max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} busy={record.isPending} icon={<Gavel className="h-4 w-4" />}>
            Record decision
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <Notice tone={s.outcome === 'REPORT' ? 'red' : s.outcome === 'DO_NOT_REPORT' ? 'neutral' : 'amber'} title={`Rule evaluation: ${s.outcome.replace(/_/g, ' ')}`}>
          {s.headline}.{s.unresolved.length > 0 && ` Unresolved: ${s.unresolved.join(' ')}`}
        </Notice>
        <div>
          <div className="mb-2 text-xs font-medium text-ink-2">Decision</div>
          <Segmented
            label="Decision"
            value={outcome}
            onChange={setOutcome}
            options={[
              { value: 'REPORT', label: 'Report', tone: 'red' },
              { value: 'DO_NOT_REPORT', label: 'Do not report', tone: 'blue' },
            ]}
          />
          {outcome === 'DO_NOT_REPORT' && (
            <p className="mt-2 text-xs text-ink-3">
              A decision not to report is the higher-risk decision. It needs a determination for every product, an exploitation assessment, an awareness event, a reason, a rationale and supporting evidence, and it goes to compliance or legal review.
            </p>
          )}
        </div>
        {outcome === 'DO_NOT_REPORT' && (
          <Field label="Reason reporting is not required" required error={fields.nonReportReason}>
            {(id) => (
              <Select id={id} value={reason} onChange={(e) => setReason(e.target.value as NonReportReason)} invalid={!!fields.nonReportReason}>
                <option value="">Select a reason</option>
                {Object.entries(NON_REPORT_REASON_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {diverges && (
          <Field label={s.outcome === 'PENDING' ? 'Why record a decision while the evaluation is pending?' : `Why does this decision differ from the suggested ${s.outcome.replace(/_/g, ' ').toLowerCase()}?`} required error={fields.divergenceReason}>
            {(id) => <TextArea id={id} value={divergence} onChange={(e) => setDivergence(e.target.value)} rows={3} invalid={!!fields.divergenceReason} placeholder={outcome === 'REPORT' ? 'e.g. precautionary early warning while affectedness is confirmed' : ''} />}
          </Field>
        )}
        <Field label="Decision rationale" required hint="At least 40 characters. Recorded verbatim in the decision record and the report." error={fields.rationale}>
          {(id) => <TextArea id={id} value={rationale} onChange={(e) => setRationale(e.target.value)} rows={5} invalid={!!fields.rationale} />}
        </Field>
        <Field label="Exploitation basis" hint="What the exploitation assessment rests on.">
          {(id) => <TextArea id={id} value={basis} onChange={(e) => setBasis(e.target.value)} rows={2} />}
        </Field>
        <div className="grid gap-5 sm:grid-cols-[auto_1fr]">
          <div>
            <div className="mb-2 text-xs font-medium text-ink-2">Confidence</div>
            <Segmented
              label="Confidence"
              value={confidence}
              onChange={setConfidence}
              options={[
                { value: 'HIGH', label: 'High', tone: 'green' },
                { value: 'MEDIUM', label: 'Medium', tone: 'amber' },
                { value: 'LOW', label: 'Low', tone: 'red' },
              ]}
            />
          </div>
          {confidence !== 'HIGH' && (
            <Field label="What remains unresolved?" required error={fields.unresolved}>
              {(id) => <TextArea id={id} value={unresolved} onChange={(e) => setUnresolved(e.target.value)} rows={2} invalid={!!fields.unresolved} />}
            </Field>
          )}
        </div>
        <div>
          <div className="mb-2 text-xs font-medium text-ink-2">
            Supporting evidence {outcome === 'DO_NOT_REPORT' && <span className="text-amber">*</span>}
          </div>
          <EvidencePicker evidence={data.bundle.evidence} value={evidenceIds} onChange={setEvidenceIds} />
          {fields.evidenceIds && <p className="mt-1.5 text-xs text-red">{fields.evidenceIds}</p>}
        </div>
        {error !== null && <ErrorState error={error} />}
      </div>
    </Drawer>
  )
}

export function DeterminationTab() {
  const { data, writable } = useCaseCtx()
  const { can } = useSession()
  const [params, setParams] = useSearchParams()
  const [open, setOpen] = useState(params.get('decide') === '1')
  const a = data.analysis
  const s = a.suggestion
  const history = [...data.bundle.decisions].reverse()
  const tone = s.outcome === 'REPORT' ? 'text-red' : s.outcome === 'DO_NOT_REPORT' ? 'text-ink' : 'text-amber'
  const Icon = s.outcome === 'REPORT' ? ShieldAlert : s.outcome === 'DO_NOT_REPORT' ? CircleSlash : Hourglass
  return (
    <div className="min-w-0 space-y-12">
      <section aria-labelledby="eval-h" className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="min-w-0">
          <div className="micro mb-2">Rule evaluation · suggested applicability · {a.ruleTrace.ruleSetVersion}</div>
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={cx('flex items-center gap-3', tone)}>
            <Icon className="h-7 w-7 shrink-0" strokeWidth={1.5} />
            <h2 id="eval-h" className="text-2xl font-medium uppercase tracking-[0.03em] sm:text-3xl">
              {s.outcome === 'REPORT' ? 'Report' : s.outcome === 'DO_NOT_REPORT' ? 'Reporting not required' : 'Pending'}
            </h2>
          </motion.div>
          <p className="mt-2 text-sm text-ink-2">{s.headline}.</p>
          {s.unresolved.length > 0 && (
            <ul className="mt-3 space-y-1">
              {s.unresolved.map((u, i) => (
                <li key={i} className="text-xs text-amber">
                  · {u}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 max-w-2xl text-xs text-ink-3">
            This is a rule evaluation, not a decision. Only a recorded decision stops a reporting clock (a decision not to report, once its decision record is approved), and the analyst may diverge from the suggestion by recording why.
          </p>
        </div>
        {can('decision.record') && writable && (
          <Button variant={a.decision ? 'secondary' : 'primary'} size="lg" icon={<Gavel className="h-4 w-4" />} onClick={() => setOpen(true)}>
            {a.decision ? 'Revise decision' : 'Record decision'}
          </Button>
        )}
      </section>

      <div className="grid min-w-0 gap-10 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section aria-labelledby="trace-h" className="min-w-0">
          <SectionTitle eyebrow="Transparent rule trace" title="Input → awareness → exploitation → effective date → applicability → deadlines" id="trace-h" />
          <div className="panel p-5 sm:p-6">
            <RuleTrace steps={a.ruleTrace.steps} />
          </div>
        </section>
        <div className="min-w-0 space-y-8">
          <Transitional />
          <ConfidencePanel />
        </div>
      </div>

      <section aria-labelledby="record-h" className="min-w-0">
        <SectionTitle eyebrow="Recorded decision" title={a.decision ? 'Current decision record' : 'No decision recorded'} id="record-h" />
        {a.decision ? (
          <DecisionRecord d={a.decision} current />
        ) : (
          <p className="max-w-2xl text-sm text-ink-3">
            No reportability decision has been recorded. Any running reporting clock continues. A decision, whether to report or not, is recorded with its rationale, the rule-set version and the evidence it rests on, and appears on the Clock of Record as a server-witnessed DECISION event.
          </p>
        )}
        {history.length > 1 && (
          <div className="mt-8 space-y-4">
            <div className="micro">Earlier decisions (kept on the record)</div>
            {history.slice(1).map((d) => (
              <DecisionRecord key={d.id} d={d} current={false} />
            ))}
          </div>
        )}
      </section>

      <RecordDecision
        open={open}
        onClose={() => {
          setOpen(false)
          if (params.get('decide')) setParams({ tab: 'determination' })
        }}
      />
    </div>
  )
}
