import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { motion } from 'motion/react'
import { Check, FileUp, Link2, Lock, Minus, Plus, ShieldCheck, X } from 'lucide-react'
import type { EvidenceClassification, EvidenceTargetType, EvidenceType } from '../../../types/domain.ts'
import { determinationEvidenceIds, eventEvidenceIds } from '../../../lib/engine/bundle.ts'
import { api, ApiFailure } from '../../../lib/client/api.ts'
import { useAction } from '../../../lib/client/queries.ts'
import { useSession } from '../../../lib/client/session.tsx'
import { bytes, fromLocalInput, short } from '../../../lib/client/format.ts'
import { Button, Field, Hash, Ident, Segmented, Select, TextArea, TextInput, cx } from '../../../components/ui/primitives.tsx'
import { Badge } from '../../../components/ui/status.tsx'
import { EmptyState, ErrorState, Notice } from '../../../components/ui/feedback.tsx'
import { Drawer, Modal, useToast } from '../../../components/ui/overlay.tsx'
import { EvidenceChips, SectionTitle, useCaseCtx } from './shared.tsx'

export const EVIDENCE_TYPES: EvidenceType[] = [
  'SBOM',
  'VEX',
  'SCANNER_RESULT',
  'EXPLOIT_EVIDENCE',
  'INCIDENT_RECORD',
  'EMAIL',
  'TICKET',
  'LOG',
  'SCREENSHOT',
  'VENDOR_ADVISORY',
  'ANALYST_NOTE',
  'POLICY',
  'CONFIGURATION',
  'THREAT_INTELLIGENCE',
  'CUSTOMER_COMMUNICATION',
]

async function sha256File(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function Checklist() {
  const { data, setTab } = useCaseCtx()
  const c = data.analysis.completeness
  return (
    <section aria-labelledby="complete-h" className="min-w-0">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="micro mb-1.5">Evidence completeness</div>
          <h2 id="complete-h" className="text-lg font-medium text-ink">
            <span className="mono text-2xl">{c.satisfied}</span> <span className="text-ink-3">of</span> <span className="mono text-2xl">{c.applicable}</span> <span className="text-ink-2">applicable items on the record</span>
          </h2>
        </div>
        <p className="max-w-sm text-xs text-ink-3">Counted from the evidence this case requires in its current state. Items that do not apply yet are shown, not counted. Never a percentage.</p>
      </div>
      <ul className="divide-y divide-line rounded-xl border border-line">
        {c.items.map((it, i) => (
          <motion.li key={it.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.04 }} className="grid min-w-0 gap-3 px-4 py-4 sm:grid-cols-[28px_minmax(0,1fr)_auto] sm:items-start">
            <span className={cx('flex h-6 w-6 items-center justify-center rounded-full border', it.state === 'satisfied' ? 'border-green-line bg-green-soft text-green' : it.state === 'missing' ? 'border-amber-line bg-amber-soft text-amber' : 'border-line text-ink-4')} aria-label={it.state}>
              {it.state === 'satisfied' ? <Check className="h-3.5 w-3.5" /> : it.state === 'missing' ? <X className="h-3.5 w-3.5" /> : <Minus className="h-3 w-3" />}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className={cx('text-sm', it.state === 'not_applicable' ? 'text-ink-3' : 'text-ink')}>{it.label}</span>
                <span className={cx('micro', it.state === 'satisfied' ? 'text-green' : it.state === 'missing' ? 'text-amber' : 'text-ink-4')}>{it.state === 'not_applicable' ? 'not applicable' : it.state}</span>
                {it.blocksDetermination && it.state === 'missing' && <span className="micro text-red">blocks determination</span>}
              </div>
              <p className="mt-1 text-xs text-ink-3 [overflow-wrap:anywhere]">{it.detail}</p>
              {it.evidenceIds.length > 0 && (
                <div className="mt-2">
                  <EvidenceChips ids={it.evidenceIds.slice(0, 8)} />
                </div>
              )}
            </div>
            {it.nextAction && (
              <button type="button" onClick={() => setTab(it.tab)} className="text-left text-xs text-amber hover:underline sm:max-w-[220px] sm:text-right">
                {it.nextAction}
              </button>
            )}
          </motion.li>
        ))}
      </ul>
    </section>
  )
}

function AddEvidence({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data } = useCaseCtx()
  const toast = useToast()
  const [mode, setMode] = useState<'file' | 'text'>('file')
  const [type, setType] = useState<EvidenceType>('LOG')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [source, setSource] = useState('')
  const [created, setCreated] = useState('')
  const [classification, setClassification] = useState<EvidenceClassification>('internal')
  const [file, setFile] = useState<File | null>(null)
  const [hash, setHash] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [error, setError] = useState<unknown>(null)
  const upload = useAction(async () => {
    const base = { caseId: data.bundle.case.id, type, title, description, source, sourceCreatedAt: created ? fromLocalInput(created) : null, classification }
    if (mode === 'file' && file) {
      const form = new FormData()
      for (const [k, v] of Object.entries(base)) if (v !== null) form.append(k, String(v))
      form.append('file', file)
      return api<{ id: string; sha256: string }>('/api/evidence', { form })
    }
    return api<{ id: string; sha256: string }>('/api/evidence', { body: { ...base, content } })
  })
  useEffect(() => {
    if (!open) return
    setTitle('')
    setDescription('')
    setSource('')
    setCreated('')
    setFile(null)
    setHash(null)
    setContent('')
    setError(null)
  }, [open])
  useEffect(() => {
    setHash(null)
    if (file) void sha256File(file).then(setHash)
  }, [file])
  const fields = error instanceof ApiFailure ? (error.body.fields ?? {}) : {}
  const ready = title.trim() && source.trim() && (mode === 'file' ? !!file : content.trim().length > 0)
  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow={data.bundle.case.id}
      title="Add evidence"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={upload.isPending}
            disabled={!ready}
            icon={<FileUp className="h-4 w-4" />}
            onClick={async () => {
              setError(null)
              try {
                const r = await upload.mutateAsync(undefined)
                toast({ tone: 'success', title: `${r.id} added`, body: `SHA-256 ${r.sha256.slice(0, 16)}… computed on the server.` })
                onClose()
              } catch (e) {
                setError(e)
              }
            }}
          >
            Add evidence
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Segmented label="Evidence input" value={mode} onChange={setMode} options={[{ value: 'file', label: 'Upload file' }, { value: 'text', label: 'Text or note' }]} />
        {mode === 'file' ? (
          <div>
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-line-bright bg-s2 px-6 py-8 text-center transition-colors hover:bg-s3">
              <FileUp className="h-5 w-5 text-ink-3" />
              <span className="mt-2 text-sm text-ink">{file ? file.name : 'Choose a file'}</span>
              <span className="mt-1 text-xs text-ink-3">{file ? bytes(file.size) : 'PDF, PNG, JPEG or UTF-8 text (logs, email, JSON, CSV), up to 10 MiB'}</span>
              <input type="file" className="sr-only" accept=".pdf,.png,.jpg,.jpeg,.txt,.log,.csv,.json,.eml,.md,.xml,.yaml,.yml" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
            {hash && (
              <div className="mt-3 rounded-lg border border-line bg-s1 px-3 py-2">
                <div className="micro">SHA-256 computed in this browser</div>
                <div className="ident mt-1 text-[11px] text-ink-2">{hash}</div>
                <div className="mt-1 text-[11px] text-ink-3">The server hashes the bytes it receives and records its own value. Compare them after upload.</div>
              </div>
            )}
          </div>
        ) : (
          <Field label="Content" required hint="Stored as a UTF-8 text object and hashed on the server.">
            {(id) => <TextArea id={id} value={content} onChange={(e) => setContent(e.target.value)} rows={7} className="mono text-[12px]" />}
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type" required>
            {(id) => (
              <Select id={id} value={type} onChange={(e) => setType(e.target.value as EvidenceType)}>
                {EVIDENCE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, ' ').toLowerCase()}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Classification" hint={classification === 'restricted' ? 'Readable only by PSIRT Lead, Security Manager, Compliance and Legal.' : undefined}>
            {(id) => (
              <Select id={id} value={classification} onChange={(e) => setClassification(e.target.value as EvidenceClassification)}>
                <option value="internal">Internal</option>
                <option value="restricted">Restricted</option>
              </Select>
            )}
          </Field>
        </div>
        <Field label="Title" required error={fields.title}>
          {(id) => <TextInput id={id} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />}
        </Field>
        <Field label="Source" required hint="Where the artifact came from" error={fields.source}>
          {(id) => <TextInput id={id} value={source} onChange={(e) => setSource(e.target.value)} />}
        </Field>
        <Field label="Created at (per its source)" hint="When the artifact itself was created. The upload time is recorded separately by the server.">
          {(id) => <TextInput id={id} type="datetime-local" value={created} onChange={(e) => setCreated(e.target.value)} />}
        </Field>
        <Field label="Description">{(id) => <TextArea id={id} value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />}</Field>
        {error !== null && <ErrorState error={error} />}
      </div>
    </Drawer>
  )
}

function LinkEvidence({ evidenceId, onClose }: { evidenceId: string | null; onClose: () => void }) {
  const { data } = useCaseCtx()
  const toast = useToast()
  const [target, setTarget] = useState('')
  const [error, setError] = useState<unknown>(null)
  const link = useAction((b: { targetType: EvidenceTargetType; targetId: string }) => api(`/api/evidence/${evidenceId}/links`, { body: b }))
  const options: Array<{ value: string; label: string }> = [
    { value: `vulnerability:${data.bundle.vulnerability.id}`, label: `Vulnerability ${data.bundle.vulnerability.cve ?? data.bundle.vulnerability.id}` },
    ...data.bundle.events.map((e) => ({ value: `clock_event:${e.id}`, label: `${e.id} · ${e.type.replace(/_/g, ' ').toLowerCase()}` })),
    ...data.bundle.determinations.map((d) => ({ value: `determination:${d.id}`, label: `${d.id} · ${data.bundle.products.find((p) => p.id === d.productId)?.name} ${d.result.replace(/_/g, ' ').toLowerCase()}` })),
    ...data.bundle.decisions.map((d) => ({ value: `decision:${d.id}`, label: `${d.id} · decision ${d.outcome.replace(/_/g, ' ').toLowerCase()}` })),
    ...data.bundle.reports.map((r) => ({ value: `report:${r.id}`, label: `${r.id} · ${r.title}` })),
  ]
  useEffect(() => {
    setTarget('')
    setError(null)
  }, [evidenceId])
  return (
    <Modal
      open={!!evidenceId}
      onClose={onClose}
      eyebrow={evidenceId ?? ''}
      title="Link evidence to a record"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!target}
            busy={link.isPending}
            onClick={async () => {
              const [targetType, targetId] = target.split(':') as [EvidenceTargetType, string]
              try {
                await link.mutateAsync({ targetType, targetId })
                toast({ tone: 'success', title: 'Evidence linked', body: `${evidenceId} → ${targetId}. Recorded in the ledger.` })
                onClose()
              } catch (e) {
                setError(e)
              }
            }}
          >
            Link evidence
          </Button>
        </>
      }
    >
      <Field label="Record" hint="Links are additive: an evidence item can support several records, and a link is never removed.">
        {(id) => (
          <Select id={id} value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Select a record</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {error !== null && <ErrorState error={error} className="mt-4" />}
    </Modal>
  )
}

export function EvidenceTab() {
  const { data, name, writable } = useCaseCtx()
  const { can } = useSession()
  const [params] = useSearchParams()
  const [adding, setAdding] = useState(params.get('add') === '1')
  const [linking, setLinking] = useState<string | null>(null)
  const [supports, setSupports] = useState(false)
  const b = data.bundle
  const decision = data.analysis.decision
  const supportSet = useMemo(() => {
    const ids = new Set<string>()
    if (!decision) return ids
    for (const id of decision.evidenceIds) ids.add(id)
    for (const d of b.determinations.filter((x) => decision.determinationIds.includes(x.id))) for (const id of determinationEvidenceIds(b, d)) ids.add(id)
    for (const e of b.events.filter((x) => decision.awarenessEventIds.includes(x.id) || (x.supersedesId && decision.awarenessEventIds.includes(x.supersedesId)))) for (const id of eventEvidenceIds(b, e)) ids.add(id)
    return ids
  }, [b, decision])
  const list = supports ? b.evidence.filter((e) => supportSet.has(e.id)) : b.evidence
  const linksOf = (id: string) => b.evidenceLinks.filter((l) => l.evidenceId === id)
  const canAdd = can('evidence.write') && writable
  return (
    <div className="min-w-0 space-y-12">
      <Checklist />
      <section aria-labelledby="register-h" className="min-w-0">
        <SectionTitle
          eyebrow="Evidence register"
          title={`${b.evidence.length} item${b.evidence.length === 1 ? '' : 's'}, each hashed on upload`}
          id="register-h"
          action={
            <>
              <Button size="sm" variant={supports ? 'primary' : 'secondary'} icon={<ShieldCheck className="h-3.5 w-3.5" />} onClick={() => setSupports((s) => !s)} disabled={!decision}>
                What evidence supports this decision?
              </Button>
              {canAdd && (
                <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAdding(true)}>
                  Add evidence
                </Button>
              )}
            </>
          }
        />
        {supports && decision && (
          <Notice tone="violet" className="mb-4" title={`Supporting ${decision.id}`}>
            {supportSet.size} items: evidence cited by the decision, by its determinations, and by the awareness events it rests on.
          </Notice>
        )}
        {list.length === 0 ? (
          <EmptyState icon={FileUp} title="No evidence" why="Every awareness event, determination and decision should rest on evidence. Add the advisory, the detection signal or the analyst's notes." action={canAdd ? <Button onClick={() => setAdding(true)}>Add evidence</Button> : undefined} />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead className="border-b border-line bg-s1">
                <tr>
                  {['Evidence', 'Type', 'Title and source', 'Created', 'Uploaded', 'Owner', 'SHA-256', 'Linked to', ''].map((h, i) => (
                    <th key={i} className="micro px-3 py-2.5 font-normal first:pl-4">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.map((e) => {
                  const links = linksOf(e.id)
                  return (
                    <tr key={e.id} className="row-line align-top">
                      <td className="px-3 py-3 pl-4">
                        <Link to={`/evidence/${e.id}`} className="ident text-[12px] text-violet hover:underline">
                          {e.id}
                        </Link>
                        {e.classification === 'restricted' && (
                          <div className="mt-1">
                            <Badge tone="amber" size="sm" icon={Lock}>
                              Restricted
                            </Badge>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-xs text-ink-2">{e.type.replace(/_/g, ' ').toLowerCase()}</td>
                      <td className="max-w-[280px] px-3 py-3">
                        <div className={cx('text-xs', e.redacted ? 'italic text-ink-3' : 'text-ink')}>{e.title}</div>
                        <div className="mt-0.5 truncate text-[11px] text-ink-3">{e.source}</div>
                      </td>
                      <td className="mono px-3 py-3 text-[11px] text-ink-3">{e.sourceCreatedAt ? short(e.sourceCreatedAt) : '--'}</td>
                      <td className="mono px-3 py-3 text-[11px] text-ink-3">{short(e.uploadedAt)}</td>
                      <td className="px-3 py-3 text-xs text-ink-2">{name(e.ownerId).split(' ')[0]}</td>
                      <td className="px-3 py-3">
                        <Hash value={e.sha256} length={8} />
                      </td>
                      <td className="px-3 py-3">
                        {links.length ? (
                          <span className="flex flex-wrap gap-1">
                            {links.slice(0, 3).map((l) => (
                              <Ident key={`${l.targetType}-${l.targetId}`} dim className="text-[10.5px]">
                                {l.targetId}
                              </Ident>
                            ))}
                            {links.length > 3 && <span className="text-[10.5px] text-ink-4">+{links.length - 3}</span>}
                          </span>
                        ) : (
                          <span className="text-[11px] text-amber">unlinked</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {canAdd && (
                          <button type="button" onClick={() => setLinking(e.id)} className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink" aria-label={`Link ${e.id}`}>
                            <Link2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-ink-3">Evidence is never deleted or edited. Files are stored outside the web root and served only through an authorised download that checks your role against the item's classification.</p>
      </section>
      <AddEvidence open={adding} onClose={() => setAdding(false)} />
      <LinkEvidence evidenceId={linking} onClose={() => setLinking(null)} />
    </div>
  )
}
