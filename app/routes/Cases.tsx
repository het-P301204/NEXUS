import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { motion } from 'motion/react'
import { FolderKanban, FolderPlus, Search, X } from 'lucide-react'
import type { CaseListItem } from '../../types/api.ts'
import type { CaseStatus, Severity } from '../../types/domain.ts'
import { api } from '../../lib/client/api.ts'
import { useAction, useCases, useProducts, useUsers, useVulnerabilities } from '../../lib/client/queries.ts'
import { useSession } from '../../lib/client/session.tsx'
import { useNow } from '../../lib/client/useNow.ts'
import { live } from '../../lib/client/live.ts'
import { inRange } from '../../lib/engine/versions.ts'
import { Button, Checkbox, Field, Ident, PageHeader, Select, SkeletonPage, TextArea, TextInput, cx } from '../../components/ui/primitives.tsx'
import { AffectednessBadge, CASE_STATUS, CaseStatusBadge, DEADLINE_STATUS, HealthBadge, SeverityMark, TONE_TEXT } from '../../components/ui/status.tsx'
import { Countdown } from '../../components/ui/time.tsx'
import { EmptyState, ErrorState, Notice } from '../../components/ui/feedback.tsx'
import { Modal, useToast } from '../../components/ui/overlay.tsx'

export function EvidenceMeter({ satisfied, applicable, className }: { satisfied: number; applicable: number; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-2', className)} title={`${satisfied} of ${applicable} applicable evidence items satisfied`}>
      <span className="inline-flex gap-[3px]" aria-hidden>
        {Array.from({ length: applicable }, (_, i) => (
          <span key={i} className={cx('h-3 w-[5px] rounded-[2px]', i < satisfied ? 'bg-green/80' : 'bg-s4 ring-1 ring-inset ring-line-strong')} />
        ))}
      </span>
      <span className="mono text-[11.5px] text-ink-2">
        {satisfied}/{applicable}
      </span>
    </span>
  )
}

function NextDeadline({ item }: { item: CaseListItem }) {
  const now = useNow()
  if (!item.nextDeadline) {
    const st = item.deadlineStatuses.find((d) => d.kind === 'EARLY_WARNING')?.status
    return <span className="text-xs text-ink-3">{st === 'NOT_APPLICABLE' ? 'Not applicable' : st === 'COMPLETED' ? 'Submitted' : 'No clock'}</span>
  }
  const d = item.nextDeadline
  const remaining = Date.parse(d.dueAt) - now
  const status = live({ kind: d.kind, dueAt: d.dueAt, status: d.status } as Parameters<typeof live>[0], now).status
  const tone = DEADLINE_STATUS[status].tone
  return (
    <span className="flex min-w-0 flex-col">
      <span className={cx('text-sm', TONE_TEXT[tone])}>
        {remaining < 0 ? <span className="mono">Overdue</span> : <Countdown dueAt={d.dueAt} size="sm" seconds={false} />}
      </span>
      <span className="truncate text-[11px] text-ink-3">{d.label}</span>
    </span>
  )
}

type ClockFilter = 'all' | 'running' | 'critical' | 'none'

export function Cases() {
  const q = useCases()
  const users = useUsers()
  const { can } = useSession()
  const [params, setParams] = useSearchParams()
  const [text, setText] = useState('')
  const [status, setStatus] = useState<CaseStatus | 'all'>('all')
  const [severity, setSeverity] = useState<Severity | 'all'>('all')
  const [clock, setClock] = useState<ClockFilter>(params.get('filter') === 'critical' ? 'critical' : 'all')
  const [product, setProduct] = useState('all')
  const [owner, setOwner] = useState('all')
  const [evidence, setEvidence] = useState<'all' | 'complete' | 'incomplete'>(params.get('view') === 'gaps' ? 'incomplete' : 'all')
  const [lifecycle, setLifecycle] = useState<'open' | 'all'>('open')
  const view = params.get('view')
  const creating = params.get('new') === '1'
  const name = (id: string) => users.data?.find((u) => u.id === id)?.name ?? id

  const items = useMemo(() => {
    let list = q.data ?? []
    if (lifecycle === 'open') list = list.filter((c) => c.lifecycle === 'open')
    if (view === 'open-determinations') list = list.filter((c) => c.status === 'AWARENESS_ESTABLISHED' || c.status === 'DETERMINATION_PENDING')
    if (status !== 'all') list = list.filter((c) => c.status === status)
    if (severity !== 'all') list = list.filter((c) => c.severity === severity)
    if (product !== 'all') list = list.filter((c) => c.products.some((p) => p.id === product))
    if (owner !== 'all') list = list.filter((c) => c.ownerId === owner)
    if (evidence === 'complete') list = list.filter((c) => c.completeness.satisfied === c.completeness.applicable)
    if (evidence === 'incomplete') list = list.filter((c) => c.completeness.satisfied < c.completeness.applicable)
    if (clock === 'running') list = list.filter((c) => c.nextDeadline)
    if (clock === 'critical') list = list.filter((c) => c.nextDeadline && (c.nextDeadline.status === 'CRITICAL' || c.nextDeadline.status === 'OVERDUE'))
    if (clock === 'none') list = list.filter((c) => !c.nextDeadline)
    const t = text.trim().toLowerCase()
    if (t) list = list.filter((c) => [c.id, c.title, c.cve, ...c.tags, ...c.products.map((p) => p.name)].some((f) => f?.toLowerCase().includes(t)))
    // Most urgent first, then most recently active.
    return [...list].sort((a, b) => {
      const da = a.nextDeadline ? Date.parse(a.nextDeadline.dueAt) : Infinity
      const db = b.nextDeadline ? Date.parse(b.nextDeadline.dueAt) : Infinity
      if (da !== db) return da - db
      return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')
    })
  }, [q.data, lifecycle, view, status, severity, product, owner, evidence, clock, text])

  const products = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of q.data ?? []) for (const p of c.products) m.set(p.id, `${p.name} ${p.version}`)
    return [...m.entries()]
  }, [q.data])

  const filtered = status !== 'all' || severity !== 'all' || clock !== 'all' || product !== 'all' || owner !== 'all' || evidence !== 'all' || text !== '' || !!view
  const clear = () => {
    setStatus('all')
    setSeverity('all')
    setClock('all')
    setProduct('all')
    setOwner('all')
    setEvidence('all')
    setText('')
    setParams({})
  }

  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  if (!q.data) return <SkeletonPage />

  return (
    <div className="min-w-0">
      <PageHeader
        eyebrow="Operate"
        title="Cases"
        description="The unit of work. Each case ties one vulnerability to the products it may affect, and carries its own clock, evidence, decision and ledger."
        actions={
          can('case.create') && (
            <Button variant="primary" icon={<FolderPlus className="h-4 w-4" />} onClick={() => setParams({ new: '1' })}>
              Create case
            </Button>
          )
        }
      />

      {params.get('intent') && <Notice tone="blue" className="mb-6">Choose a case to continue.</Notice>}

      <div className="mb-6 flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-4" />
            <TextInput value={text} onChange={(e) => setText(e.target.value)} placeholder="Case, CVE, product, tag" className="pl-9" aria-label="Search cases" />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value as CaseStatus | 'all')} aria-label="Status" className="w-auto">
            <option value="all">All statuses</option>
            {Object.entries(CASE_STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
          <Select value={clock} onChange={(e) => setClock(e.target.value as ClockFilter)} aria-label="Clock state" className="w-auto">
            <option value="all">Any clock state</option>
            <option value="running">Clock running</option>
            <option value="critical">Critical or overdue</option>
            <option value="none">No running clock</option>
          </Select>
          <Select value={severity} onChange={(e) => setSeverity(e.target.value as Severity | 'all')} aria-label="Severity" className="w-auto">
            <option value="all">Any severity</option>
            <option value="CRITICAL">Critical</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </Select>
          <Select value={product} onChange={(e) => setProduct(e.target.value)} aria-label="Product" className="w-auto">
            <option value="all">All products</option>
            {products.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </Select>
          <Select value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Analyst" className="w-auto">
            <option value="all">Any analyst</option>
            {(users.data ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
          <Select value={evidence} onChange={(e) => setEvidence(e.target.value as 'all' | 'complete' | 'incomplete')} aria-label="Evidence completeness" className="w-auto">
            <option value="all">Any evidence state</option>
            <option value="complete">Evidence complete</option>
            <option value="incomplete">Evidence incomplete</option>
          </Select>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-ink-3">
          <div className="flex items-center gap-3">
            <span className="mono">
              {items.length} case{items.length === 1 ? '' : 's'}
            </span>
            {view === 'open-determinations' && <span className="text-amber">Awaiting a reportability decision</span>}
            {filtered && (
              <button type="button" onClick={clear} className="inline-flex items-center gap-1 text-ink-2 hover:text-ink">
                <X className="h-3 w-3" /> Clear filters
              </button>
            )}
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={lifecycle === 'all'} onChange={(e) => setLifecycle(e.target.checked ? 'all' : 'open')} className="accent-amber" />
            Include closed and archived
          </label>
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title={filtered ? 'No cases match' : 'No cases'}
          why={filtered ? 'No case matches every filter. Clear a filter to widen the search.' : 'Cases are opened when a vulnerability may affect a product. Create one from a vulnerability record.'}
          action={filtered ? <Button onClick={clear}>Clear filters</Button> : can('case.create') ? <Button onClick={() => setParams({ new: '1' })}>Create case</Button> : undefined}
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden min-w-0 overflow-hidden rounded-xl border border-line lg:block">
            <table className="w-full table-fixed text-left">
              <thead className="border-b border-line bg-s1">
                <tr>
                  <th className="micro w-[30%] px-4 py-3 font-normal">Case</th>
                  <th className="micro w-[15%] px-3 py-3 font-normal">Status</th>
                  <th className="micro w-[14%] px-3 py-3 font-normal">Affectedness</th>
                  <th className="micro w-[13%] px-3 py-3 font-normal">Next deadline</th>
                  <th className="micro w-[10%] px-3 py-3 font-normal">Evidence</th>
                  <th className="micro w-[10%] px-3 py-3 font-normal">Health</th>
                  <th className="micro w-[8%] px-3 py-3 font-normal">Owner</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c, i) => (
                  <motion.tr key={c.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i, 12) * 0.025 }} className="row-line group">
                    <td className="px-4 py-3.5 align-top">
                      <Link to={`/cases/${c.id}`} className="block min-w-0">
                        <div className="flex items-center gap-2">
                          <Ident className="text-[12px] group-hover:text-amber">{c.cve ?? c.vulnerabilityId}</Ident>
                          <SeverityMark severity={c.severity} showLabel={false} />
                        </div>
                        <div className="mt-1 truncate text-sm text-ink">{c.title}</div>
                        <div className="mt-1 flex min-w-0 items-center gap-2 text-[11.5px] text-ink-3">
                          <Ident dim className="shrink-0 text-[11px]">
                            {c.id}
                          </Ident>
                          <span className="truncate">{c.products.map((p) => p.name).join(', ')}</span>
                        </div>
                      </Link>
                    </td>
                    <td className="px-3 py-3.5 align-top">
                      <CaseStatusBadge status={c.status} size="sm" />
                    </td>
                    <td className="px-3 py-3.5 align-top">
                      <AffectednessBadge result={c.affectedness} size="sm" />
                    </td>
                    <td className="px-3 py-3.5 align-top">
                      <NextDeadline item={c} />
                    </td>
                    <td className="px-3 py-3.5 align-top">
                      <EvidenceMeter satisfied={c.completeness.satisfied} applicable={c.completeness.applicable} />
                    </td>
                    <td className="px-3 py-3.5 align-top">
                      <span title={c.health.reason}>
                        <HealthBadge state={c.health.state} size="sm" />
                      </span>
                    </td>
                    <td className="truncate px-3 py-3.5 align-top text-xs text-ink-2">{name(c.ownerId).split(' ')[0]}</td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Mobile and tablet list */}
          <ul className="divide-y divide-line border-y border-line lg:hidden">
            {items.map((c) => (
              <li key={c.id}>
                <Link to={`/cases/${c.id}`} className="block py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Ident className="text-[12px]">{c.cve ?? c.vulnerabilityId}</Ident>
                      <div className="mt-1 text-sm text-ink">{c.title}</div>
                      <Ident dim className="mt-1 block text-[11px]">
                        {c.id}
                      </Ident>
                    </div>
                    <NextDeadline item={c} />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <CaseStatusBadge status={c.status} size="sm" />
                    <AffectednessBadge result={c.affectedness} size="sm" />
                    <EvidenceMeter satisfied={c.completeness.satisfied} applicable={c.completeness.applicable} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      <CreateCaseModal open={creating} onClose={() => setParams({})} initialVulnerability={params.get('vulnerabilityId')} />
    </div>
  )
}

function CreateCaseModal({ open, onClose, initialVulnerability }: { open: boolean; onClose: () => void; initialVulnerability: string | null }) {
  const vulns = useVulnerabilities()
  const products = useProducts()
  const users = useUsers()
  const { session, can } = useSession()
  const toast = useToast()
  const navigate = useNavigate()
  const [vulnerabilityId, setVulnerabilityId] = useState('')
  const [title, setTitle] = useState('')
  const [productIds, setProductIds] = useState<string[]>([])
  const [ownerId, setOwnerId] = useState('')
  const [tags, setTags] = useState('')
  const [summary, setSummary] = useState('')
  const [error, setError] = useState<unknown>(null)
  const create = useAction((body: unknown) => api<{ id: string }>('/api/cases', { body }))

  useEffect(() => {
    if (!open) return
    setVulnerabilityId(initialVulnerability ?? '')
    setProductIds([])
    setTitle('')
    setTags('')
    setSummary('')
    setError(null)
    setOwnerId(session?.user.id ?? '')
  }, [open, initialVulnerability, session])

  const vuln = vulns.data?.find((v) => v.id === vulnerabilityId)
  // Products whose SBOM contains the component, and whether the version is in range.
  const exposure = useMemo(() => {
    const m = new Map<string, { version: string; inRange: boolean | null }>()
    if (!vuln?.componentId) return m
    for (const p of products.data ?? []) {
      const pc = p.components.find((c) => c.componentId === vuln.componentId)
      if (pc) m.set(p.id, { version: pc.version, inRange: inRange(pc.version, vuln.affectedVersions) })
    }
    return m
  }, [vuln, products.data])

  useEffect(() => {
    if (vuln && !title) setTitle(`${vuln.title.split(' (')[0]} -- ${[...exposure.keys()].map((id) => products.data?.find((p) => p.id === id)?.name).filter(Boolean).slice(0, 2).join(' and ') || 'products to be confirmed'}`)
    if (vuln && productIds.length === 0) setProductIds([...exposure.entries()].filter(([, e]) => e.inRange !== false).map(([id]) => id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vulnerabilityId, exposure])

  const submit = async () => {
    setError(null)
    try {
      const r = await create.mutateAsync({
        title,
        vulnerabilityId,
        productIds,
        ...(ownerId && ownerId !== session?.user.id ? { ownerId } : {}),
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        summary,
      })
      toast({ tone: 'success', title: `${r.id} created`, body: 'Record detection and awareness on the Clock of Record next.' })
      onClose()
      navigate(`/cases/${r.id}?tab=clock`)
    } catch (e) {
      setError(e)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="New case"
      title="Create case"
      width="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} busy={create.isPending} disabled={!vulnerabilityId || productIds.length === 0 || !title.trim()}>
            Create case
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Vulnerability" required hint={<Link to="/vulnerabilities/new" className="text-ink-2 hover:text-amber">Not listed? Add it through vulnerability intake →</Link>}>
          {(id) => (
            <Select id={id} value={vulnerabilityId} onChange={(e) => setVulnerabilityId(e.target.value)}>
              <option value="">Select a vulnerability</option>
              {(vulns.data ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.cve ?? v.id} · {v.title}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Title" required>
          {(id) => <TextInput id={id} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} />}
        </Field>
        <div>
          <div className="mb-1.5 text-xs font-medium text-ink-2">Products in scope <span className="text-amber">*</span></div>
          <p className="mb-3 text-xs text-ink-3">An SBOM match means the product contains the component. Whether it is affected is decided per product inside the case.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {(products.data ?? []).map((p) => {
              const e = exposure.get(p.id)
              const checked = productIds.includes(p.id)
              return (
                <div key={p.id} className={cx('rounded-lg border px-3 py-2.5 transition-colors', checked ? 'border-line-bright bg-s3' : 'border-line bg-s2')}>
                  <Checkbox
                    checked={checked}
                    onChange={(v) => setProductIds((xs) => (v ? [...xs, p.id] : xs.filter((x) => x !== p.id)))}
                    label={`${p.name} ${p.version}`}
                    description={e ? `${e.version}: ${e.inRange === true ? 'in vulnerable range' : e.inRange === false ? 'outside range' : 'version not comparable'}` : vuln?.componentId ? 'Component not in SBOM' : p.id}
                  />
                </div>
              )
            })}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Owner" hint={can('case.assign') ? undefined : 'Assigning a case to someone else needs the case.assign permission.'}>
            {(id) => (
              <Select id={id} value={ownerId} onChange={(e) => setOwnerId(e.target.value)} disabled={!can('case.assign')}>
                {(users.data ?? []).filter((u) => u.role !== 'read_only').map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Tags" hint="Comma separated">
            {(id) => <TextInput id={id} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tls, internet-facing" />}
          </Field>
        </div>
        <Field label="Summary">{(id) => <TextArea id={id} value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} />}</Field>
        {error !== null && <ErrorState error={error} />}
      </div>
    </Modal>
  )
}
