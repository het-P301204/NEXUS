import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ChevronDown, Download, FileJson, Paperclip, Scale, Sparkles } from 'lucide-react'
import type { AffectednessStepId, Answer, Confidence, Determination, Product, StepAnswer } from '../../../types/domain.ts'
import { STEPS, emptyAnswers, evaluateAffectedness, JUSTIFICATION_LABELS } from '../../../lib/engine/affectedness.ts'
import { determinationEvidenceIds } from '../../../lib/engine/bundle.ts'
import { buildVex } from '../../../lib/engine/vex.ts'
import { api, ApiFailure, download } from '../../../lib/client/api.ts'
import { useAction } from '../../../lib/client/queries.ts'
import { useSession } from '../../../lib/client/session.tsx'
import { fromLocalInput, short, stamp, toLocalInput } from '../../../lib/client/format.ts'
import { nowMs } from '../../../lib/client/useNow.ts'
import { Button, Field, Ident, KeyValue, Segmented, Select, TextArea, TextInput, cx } from '../../../components/ui/primitives.tsx'
import { AffectednessBadge, Badge } from '../../../components/ui/status.tsx'
import { EmptyState, ErrorState, Notice } from '../../../components/ui/feedback.tsx'
import { Drawer, useToast } from '../../../components/ui/overlay.tsx'
import { ReasoningFlow } from '../../../components/reasoning/ReasoningFlow.tsx'
import { EvidencePicker } from '../../../components/reasoning/EvidencePicker.tsx'
import { EvidenceChips, SectionTitle, useCaseCtx } from './shared.tsx'

const SBOM_TONE = { current: 'green', stale: 'amber', missing: 'red' } as const

function ProductBlock({ product, onRecord }: { product: Product; onRecord?: () => void }) {
  const { data, name } = useCaseCtx()
  const [history, setHistory] = useState(false)
  const d = data.analysis.determinations[product.id]
  const evaluation = data.analysis.evaluations[product.id]
  const pc = data.bundle.productComponents.find((x) => x.productId === product.id && x.componentId === data.bundle.vulnerability.componentId)
  const component = data.bundle.components.find((c) => c.id === data.bundle.vulnerability.componentId)
  const sbom = data.sbom[product.id] ?? []
  const past = data.bundle.determinations.filter((x) => x.productId === product.id && x.id !== d?.id).reverse()
  return (
    <article className="panel min-w-0 overflow-hidden">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-5 py-5 sm:px-6">
        <div className="min-w-0">
          <Link to={`/products/${product.id}`} className="text-lg font-medium text-ink hover:text-amber">
            {product.name} <span className="mono text-md text-ink-2">{product.version}</span>
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-3">
            <Ident dim>{product.id}</Ident>
            <Badge tone={SBOM_TONE[product.sbomStatus]} size="sm">
              SBOM {product.sbomStatus}
            </Badge>
            <span>{product.exposure.replace(/_/g, ' ')}</span>
            <span>{product.madeAvailableInEu ? 'Made available in the EU' : 'Not made available in the EU'}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <AffectednessBadge result={d ? d.result : 'NO_DETERMINATION'} />
          {onRecord && (
            <Button size="sm" variant={d ? 'secondary' : 'primary'} icon={<Scale className="h-3.5 w-3.5" />} onClick={onRecord}>
              {d ? 'Revise determination' : 'Record determination'}
            </Button>
          )}
        </div>
      </header>

      <div className="grid min-w-0 gap-8 px-5 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="min-w-0 space-y-5">
          <div>
            <div className="micro mb-2">Contains the component?</div>
            <p className="text-sm text-ink-2">
              {pc ? (
                <>
                  SBOM lists <span className="mono text-ink">{component?.name} {pc.version}</span> ({pc.relation}).
                </>
              ) : (
                <>No SBOM entry for {component?.name ?? 'the component'}.</>
              )}
            </p>
            {pc?.usage && <p className="mt-1.5 text-xs text-ink-3">Usage: {pc.usage}</p>}
            <ul className="mt-2 space-y-1">
              {sbom.map((s) => (
                <li key={s.step} className="flex items-start gap-2 text-xs">
                  <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-blue" />
                  <span className="text-ink-3">
                    Step {s.step === 'component_present' ? 1 : 2} from SBOM: <span className="mono text-ink-2">{s.answer}</span>. {s.detail}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-ink-3">Containing the component is steps 1 and 2. Whether the product is affected needs steps 3 to 9, answered by someone who has looked at the product.</p>
          </div>
          {d ? (
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <KeyValue label="Determination" mono>
                {d.id}
              </KeyValue>
              <KeyValue label="VEX status" mono>
                {d.vexStatus}
                {d.vexJustification && <span className="block text-[11px] text-ink-3">{JUSTIFICATION_LABELS[d.vexJustification]}</span>}
              </KeyValue>
              <KeyValue label="Analyst">{name(d.analystId)}</KeyValue>
              <KeyValue label="Recorded" mono>
                {short(d.recordedAt)}
              </KeyValue>
              <KeyValue label="Confidence">
                <Badge tone={d.confidence === 'HIGH' ? 'green' : d.confidence === 'MEDIUM' ? 'amber' : 'red'} size="sm">
                  {d.confidence}
                </Badge>
              </KeyValue>
              <KeyValue label="Evidence">
                <EvidenceChips ids={determinationEvidenceIds(data.bundle, d)} />
              </KeyValue>
              <div className="sm:col-span-2">
                <dt className="micro mb-1">Rationale</dt>
                <dd className="text-sm text-ink-2">{d.rationale}</dd>
              </div>
              {d.unresolved && (
                <div className="sm:col-span-2">
                  <dt className="micro mb-1 text-amber">Unresolved</dt>
                  <dd className="text-sm text-ink-2">{d.unresolved}</dd>
                </div>
              )}
              {d.result === 'UNDER_INVESTIGATION' && d.nextAction && (
                <div className="rounded-lg border border-amber-line bg-amber/[0.036] px-3 py-2.5 sm:col-span-2">
                  <div className="micro text-amber">Next action</div>
                  <p className="mt-1 text-sm text-ink">{d.nextAction}</p>
                  <p className="mt-1 text-xs text-ink-3">
                    Owner {name(d.nextActionOwnerId)} · due <span className="mono">{d.nextActionDue ? short(d.nextActionDue) : '--'}</span>
                  </p>
                </div>
              )}
              {evaluation?.actionStatement && (
                <div className="sm:col-span-2">
                  <dt className="micro mb-1">Action statement</dt>
                  <dd className="text-sm text-ink-2">{evaluation.actionStatement}</dd>
                </div>
              )}
            </dl>
          ) : (
            <Notice tone="amber" title="No determination">
              Until a determination is recorded, {product.name} counts as under investigation. Under investigation is not a pass, and any running clock keeps running.
            </Notice>
          )}
        </div>
        <div className="min-w-0">
          <div className="micro mb-3">Reasoning</div>
          {d && evaluation ? <ReasoningFlow evaluation={evaluation} answers={d.answers} /> : <p className="text-sm text-ink-3">The reasoning flow appears once a determination is recorded.</p>}
        </div>
      </div>

      {past.length > 0 && (
        <div className="border-t border-line px-5 py-3 sm:px-6">
          <button type="button" onClick={() => setHistory((h) => !h)} className="flex items-center gap-1.5 text-xs text-ink-3 hover:text-ink" aria-expanded={history}>
            <ChevronDown className={cx('h-3.5 w-3.5 transition-transform', history && 'rotate-180')} /> {past.length} earlier determination{past.length > 1 ? 's' : ''} (kept on the record)
          </button>
          {history && (
            <ul className="mt-3 space-y-2">
              {past.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center gap-3 text-xs text-ink-3">
                  <Ident className="text-[11px]">{x.id}</Ident>
                  <AffectednessBadge result={x.result} size="sm" />
                  <span className="mono">{short(x.recordedAt)}</span>
                  <span>{name(x.analystId)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </article>
  )
}

function DeterminationDrawer({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const { data, users } = useCaseCtx()
  const toast = useToast()
  const [answers, setAnswers] = useState<Record<AffectednessStepId, StepAnswer>>(emptyAnswers())
  const [rationale, setRationale] = useState('')
  const [confidence, setConfidence] = useState<Confidence>('HIGH')
  const [unresolved, setUnresolved] = useState('')
  const [nextAction, setNextAction] = useState('')
  const [owner, setOwner] = useState('')
  const [due, setDue] = useState('')
  const [openStep, setOpenStep] = useState<AffectednessStepId | null>(null)
  const [error, setError] = useState<unknown>(null)
  const post = useAction((b: unknown) => api<{ id: string; result: string }>(`/api/cases/${data.bundle.case.id}/determinations`, { body: b }))

  useEffect(() => {
    if (!product) return
    const current = data.analysis.determinations[product.id]
    const base = current ? structuredClone(current.answers) : emptyAnswers()
    if (!current) {
      for (const s of data.sbom[product.id] ?? []) base[s.step] = { ...base[s.step], answer: s.answer, note: `Suggested from SBOM: ${s.detail}` }
    }
    setAnswers(base)
    setRationale(current?.rationale ?? '')
    setConfidence(current?.confidence ?? 'HIGH')
    setUnresolved(current?.unresolved ?? '')
    setNextAction(current?.nextAction ?? '')
    setOwner(current?.nextActionOwnerId ?? '')
    setDue(current?.nextActionDue ? toLocalInput(current.nextActionDue, undefined, false) : toLocalInput(new Date(nowMs() + 86_400_000).toISOString(), undefined, false))
    setError(null)
    setOpenStep(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product])

  const evaluation = useMemo(() => evaluateAffectedness(answers), [answers])
  const ui = evaluation.result === 'UNDER_INVESTIGATION'
  const fields = error instanceof ApiFailure ? (error.body.fields ?? {}) : {}
  const set = (id: AffectednessStepId, patch: Partial<StepAnswer>) => setAnswers((a) => ({ ...a, [id]: { ...a[id], ...patch } }))

  return (
    <Drawer
      open={!!product}
      onClose={onClose}
      eyebrow={`${data.bundle.case.id} · affectedness engine`}
      title={product ? `${product.name} ${product.version}` : ''}
      width="sm:max-w-3xl"
      footer={
        <>
          <span className="mr-auto flex items-center gap-2 text-xs text-ink-3">
            Result <AffectednessBadge result={evaluation.result} size="sm" />
          </span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={post.isPending}
            onClick={async () => {
              setError(null)
              try {
                const r = await post.mutateAsync({
                  productId: product!.id,
                  answers,
                  rationale,
                  confidence,
                  unresolved,
                  nextAction,
                  nextActionOwnerId: owner || null,
                  nextActionDue: due ? fromLocalInput(due) : null,
                })
                toast({ tone: 'success', title: `${r.id} recorded`, body: `${product!.name}: ${r.result.replace(/_/g, ' ').toLowerCase()}. The server computed the result from the answers.` })
                onClose()
              } catch (e) {
                setError(e)
              }
            }}
          >
            Record determination
          </Button>
        </>
      }
    >
      <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0 space-y-2">
          {STEPS.map((s) => {
            const a = answers[s.id]
            const pathStep = evaluation.path[s.n - 1]!
            const expanded = openStep === s.id
            return (
              <div key={s.id} className={cx('rounded-lg border px-3.5 py-3 transition-colors', pathStep.effect === 'decides' || pathStep.effect === 'blocks' ? 'border-line-bright bg-s2' : 'border-line', pathStep.effect === 'not_reached' && 'opacity-60')}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="mono text-[11px] text-ink-4">{String(s.n).padStart(2, '0')}</span>
                      <span className="text-sm text-ink">{s.question}</span>
                    </div>
                    <p className="mt-1 text-xs text-ink-3">{s.help}</p>
                  </div>
                  <Segmented<Answer | 'NONE'>
                    label={s.question}
                    size="sm"
                    value={a.answer ?? 'NONE'}
                    onChange={(v) => set(s.id, { answer: v === 'NONE' ? null : v })}
                    options={[
                      { value: 'YES', label: 'Yes' },
                      { value: 'NO', label: 'No' },
                      { value: 'UNKNOWN', label: 'Unknown', tone: 'amber' },
                      { value: 'NONE', label: '—' },
                    ]}
                  />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <button type="button" onClick={() => setOpenStep(expanded ? null : s.id)} className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink" aria-expanded={expanded}>
                    <Paperclip className="h-3 w-3" /> Note and evidence {a.evidenceIds.length > 0 && <span className="mono text-violet">({a.evidenceIds.length})</span>}
                  </button>
                  {a.note && !expanded && <span className="truncate text-[11px] text-ink-4">{a.note}</span>}
                </div>
                {expanded && (
                  <div className="mt-3 space-y-3">
                    <TextArea value={a.note} onChange={(e) => set(s.id, { note: e.target.value })} rows={2} placeholder="What the answer rests on" aria-label={`Note for step ${s.n}`} />
                    <EvidencePicker evidence={data.bundle.evidence} value={a.evidenceIds} onChange={(ids) => set(s.id, { evidenceIds: ids })} />
                  </div>
                )}
              </div>
            )
          })}
          <div className="space-y-4 pt-4">
            <Field label="Rationale" required error={fields.rationale} hint="At least 20 characters.">
              {(id) => <TextArea id={id} value={rationale} onChange={(e) => setRationale(e.target.value)} rows={3} />}
            </Field>
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <div className="mb-2 text-xs font-medium text-ink-2">Confidence</div>
                <Segmented label="Confidence" value={confidence} onChange={setConfidence} options={[{ value: 'HIGH', label: 'High', tone: 'green' }, { value: 'MEDIUM', label: 'Medium', tone: 'amber' }, { value: 'LOW', label: 'Low', tone: 'red' }]} />
              </div>
            </div>
            {confidence !== 'HIGH' && (
              <Field label="What remains unresolved?" required error={fields.unresolved}>
                {(id) => <TextArea id={id} value={unresolved} onChange={(e) => setUnresolved(e.target.value)} rows={2} placeholder="e.g. Product exploitability has not been validated against production configuration." />}
              </Field>
            )}
            {ui && (
              <div className="rounded-lg border border-amber-line p-4">
                <div className="micro mb-3 text-amber">Under investigation needs a next action</div>
                <div className="space-y-3">
                  <Field label="Next action" required error={fields.nextAction}>
                    {(id) => <TextInput id={id} value={nextAction} onChange={(e) => setNextAction(e.target.value)} />}
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Owner" required error={fields.nextActionOwnerId}>
                      {(id) => (
                        <Select id={id} value={owner} onChange={(e) => setOwner(e.target.value)}>
                          <option value="">Select</option>
                          {users.filter((u) => u.role !== 'read_only').map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    <Field label="Due" required error={fields.nextActionDue}>
                      {(id) => <TextInput id={id} type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />}
                    </Field>
                  </div>
                </div>
              </div>
            )}
            {error !== null && <ErrorState error={error} />}
          </div>
        </div>
        <aside className="min-w-0 lg:sticky lg:top-0 lg:self-start">
          <div className="micro mb-3">Live evaluation</div>
          <ReasoningFlow evaluation={evaluation} answers={answers} compact />
          <ul className="mt-4 space-y-1.5">
            {evaluation.reasons.map((r, i) => (
              <li key={i} className="text-xs text-ink-2">
                {r}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[11px] text-ink-4">Shown for guidance. The server re-evaluates the answers and records its own result.</p>
        </aside>
      </div>
    </Drawer>
  )
}

function VexOutput() {
  const { data, name } = useCaseCtx()
  const { session } = useSession()
  const [raw, setRaw] = useState(false)
  const vex = useMemo(() => (session ? buildVex(data.bundle, data.analysis, session.org, name, data.analysis.now) : null), [data, session, name])
  if (!vex || vex.statements.length === 0) {
    return <EmptyState compact icon={FileJson} title="No VEX statements" why="A VEX-style statement is produced for each product once its determination is recorded." />
  }
  return (
    <div className="min-w-0">
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[780px] text-left text-sm">
          <thead className="border-b border-line bg-s1">
            <tr>
              {['Status', 'Justification', 'Product', 'Component', 'Version', 'Analyst', 'Timestamp', 'Evidence'].map((h) => (
                <th key={h} className="micro px-3 py-2.5 font-normal first:pl-4">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {vex.statements.map((s, i) => {
              const d: Determination | undefined = Object.values(data.analysis.determinations).find((x) => x.id === s['x-nexus'].determination)
              const product = data.bundle.products.find((p) => p.id === s['x-nexus'].product)
              const pc = data.bundle.productComponents.find((x) => x.id === d?.productComponentId)
              return (
                <tr key={i} className="row-line align-top">
                  <td className="px-3 py-3 pl-4">
                    <AffectednessBadge result={d?.result ?? 'UNDER_INVESTIGATION'} size="sm" />
                    <div className="mono mt-1 text-[11px] text-ink-3">{s.status}</div>
                  </td>
                  <td className="mono px-3 py-3 text-[11.5px] text-ink-2">{s.justification ?? '--'}</td>
                  <td className="px-3 py-3 text-xs text-ink">{product?.name}</td>
                  <td className="ident px-3 py-3 text-[11.5px] text-ink-2">{data.bundle.components.find((c) => c.id === data.bundle.vulnerability.componentId)?.name}</td>
                  <td className="mono px-3 py-3 text-xs text-ink-2">{pc?.version ?? '--'}</td>
                  <td className="px-3 py-3 text-xs text-ink-2">{s['x-nexus'].analyst}</td>
                  <td className="mono px-3 py-3 text-xs text-ink-3">{stamp(s.timestamp)}</td>
                  <td className="px-3 py-3">
                    <EvidenceChips ids={s['x-nexus'].evidence} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={() => void download(`/api/cases/${data.bundle.case.id}/vex`, `${data.bundle.case.id}.openvex.json`)}>
          Download VEX JSON
        </Button>
        <button type="button" onClick={() => setRaw((r) => !r)} className="text-xs text-ink-3 hover:text-ink">
          {raw ? 'Hide' : 'Show'} document
        </button>
        <span className="text-xs text-ink-3">VEX-style: shaped after OpenVEX v0.2.0, not schema-validated or signed.</span>
      </div>
      {raw && <pre className="mono mt-3 max-h-96 overflow-auto rounded-lg border border-line bg-s1 p-4 text-[11.5px] leading-relaxed text-ink-2">{JSON.stringify(vex, null, 2)}</pre>}
    </div>
  )
}

export function ProductsTab() {
  const { data, writable } = useCaseCtx()
  const { can } = useSession()
  const [params, setParams] = useSearchParams()
  const [editing, setEditing] = useState<Product | null>(null)
  const canRecord = can('determination.record') && writable
  useEffect(() => {
    if (params.get('record') && canRecord) setEditing(data.bundle.products.find((p) => !data.analysis.determinations[p.id]) ?? data.bundle.products[0] ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div className="min-w-0 space-y-12">
      <section className="min-w-0">
        <SectionTitle eyebrow="Affectedness engine" title="Contains the vulnerable component is not the same as affected" />
        <p className="-mt-2 mb-6 max-w-3xl text-sm text-ink-3">
          Each product is evaluated through nine ordered questions. An unknown answer makes it UNDER INVESTIGATION, never NOT AFFECTED. NOT AFFECTED is recorded only with product-specific validation and evidence on the deciding answer.
        </p>
        <div className="space-y-6">
          {data.bundle.products.map((p) => (
            <ProductBlock key={p.id} product={p} onRecord={canRecord ? () => setEditing(p) : undefined} />
          ))}
        </div>
      </section>
      <section className="min-w-0">
        <SectionTitle eyebrow="VEX-style output" title="Structured determination per product" />
        <VexOutput />
      </section>
      <DeterminationDrawer
        product={editing}
        onClose={() => {
          setEditing(null)
          if (params.get('record')) setParams({ tab: 'products' })
        }}
      />
    </div>
  )
}
