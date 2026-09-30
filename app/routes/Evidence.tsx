import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { motion } from 'motion/react'
import { Fingerprint, Lock, Plus, Search } from 'lucide-react'
import type { EvidenceType } from '../../types/domain.ts'
import { useCases, useEvidence, useUsers } from '../../lib/client/queries.ts'
import { useSession } from '../../lib/client/session.tsx'
import { short } from '../../lib/client/format.ts'
import { Button, Field, Hash, Ident, PageHeader, Select, SkeletonPage, TextInput, cx } from '../../components/ui/primitives.tsx'
import { Badge } from '../../components/ui/status.tsx'
import { EmptyState, ErrorState } from '../../components/ui/feedback.tsx'
import { Modal } from '../../components/ui/overlay.tsx'

export function Evidence() {
  const q = useEvidence()
  const users = useUsers()
  const cases = useCases()
  const { can } = useSession()
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const [type, setType] = useState<EvidenceType | 'all'>('all')
  const [caseId, setCaseId] = useState('all')
  const [linked, setLinked] = useState<'all' | 'linked' | 'unlinked'>('all')
  const [picking, setPicking] = useState(false)
  const [target, setTarget] = useState('')
  const name = (id: string) => users.data?.find((u) => u.id === id)?.name ?? id

  const list = useMemo(() => {
    let l = q.data ?? []
    if (type !== 'all') l = l.filter((e) => e.type === type)
    if (caseId !== 'all') l = l.filter((e) => e.caseId === caseId)
    if (linked === 'linked') l = l.filter((e) => e.links.length > 0)
    if (linked === 'unlinked') l = l.filter((e) => e.links.length === 0)
    const t = text.trim().toLowerCase()
    if (t) l = l.filter((e) => [e.id, e.title, e.source, e.sha256, e.caseId].some((f) => f?.toLowerCase().includes(t)))
    return [...l].reverse()
  }, [q.data, type, caseId, linked, text])

  const byType = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of q.data ?? []) m.set(e.type, (m.get(e.type) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [q.data])

  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  if (!q.data) return <SkeletonPage />
  const all = q.data
  const max = Math.max(1, ...byType.map(([, n]) => n))

  return (
    <div className="min-w-0">
      <PageHeader
        eyebrow="Record"
        title="Evidence center"
        description="Every artifact behind every awareness event, determination, decision and report. Each is hashed with SHA-256 on the server when it arrives, stored outside the web root, and never edited or deleted."
        actions={
          can('evidence.write') && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setPicking(true)}>
              Add evidence to a case
            </Button>
          )
        }
      />

      <div className="grid min-w-0 gap-10 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0">
          <div className="mb-5 flex min-w-0 flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-4" />
              <TextInput value={text} onChange={(e) => setText(e.target.value)} placeholder="ID, title, source or SHA-256" className="pl-9" aria-label="Search evidence" />
            </div>
            <Select value={type} onChange={(e) => setType(e.target.value as EvidenceType | 'all')} className="w-auto" aria-label="Type">
              <option value="all">All types</option>
              {byType.map(([t]) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, ' ').toLowerCase()}
                </option>
              ))}
            </Select>
            <Select value={caseId} onChange={(e) => setCaseId(e.target.value)} className="w-auto" aria-label="Case">
              <option value="all">All cases</option>
              {(cases.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id}
                </option>
              ))}
            </Select>
            <Select value={linked} onChange={(e) => setLinked(e.target.value as 'all' | 'linked' | 'unlinked')} className="w-auto" aria-label="Links">
              <option value="all">Linked and unlinked</option>
              <option value="linked">Linked to a record</option>
              <option value="unlinked">Not linked</option>
            </Select>
            <span className="mono ml-auto text-xs text-ink-3">
              {list.length} of {all.length}
            </span>
          </div>
          {list.length === 0 ? (
            <EmptyState icon={Fingerprint} title="No evidence matches" why="Change the filters, or add evidence from a case's Evidence tab." />
          ) : (
            <ul className="divide-y divide-line border-y border-line">
              {list.map((e, i) => (
                <motion.li key={e.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i, 20) * 0.015 }}>
                  <Link to={`/evidence/${e.id}`} className="group grid min-w-0 gap-x-5 gap-y-2 py-4 transition-colors hover:bg-s1 sm:grid-cols-[92px_minmax(0,1fr)_170px] sm:px-2">
                    <div className="min-w-0">
                      <Ident className="text-[12px] text-violet group-hover:underline">{e.id}</Ident>
                      <div className="micro mt-1 text-ink-4">{e.type.replace(/_/g, ' ')}</div>
                    </div>
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        {e.classification === 'restricted' && <Lock className="h-3.5 w-3.5 shrink-0 text-amber" aria-label="Restricted" />}
                        <span className={cx('truncate text-sm', e.redacted ? 'italic text-ink-3' : 'text-ink')}>{e.title}</span>
                      </div>
                      <div className="mt-0.5 truncate text-xs text-ink-3">
                        {e.source} · {name(e.ownerId)}
                        {e.caseId && (
                          <>
                            {' '}
                            · <span className="ident">{e.caseId}</span>
                          </>
                        )}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {e.links.length === 0 ? (
                          <span className="text-[11px] text-amber">Not linked to any record</span>
                        ) : (
                          e.links.slice(0, 5).map((l) => (
                            <span key={`${l.targetType}-${l.targetId}`} className="mono rounded border border-line px-1.5 text-[10.5px] text-ink-3">
                              {l.targetId}
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                    <div className="min-w-0 sm:text-right">
                      <Hash value={e.sha256} length={8} copy={false} />
                      <div className="mono mt-1 text-[11px] text-ink-4">uploaded {short(e.uploadedAt)}</div>
                    </div>
                  </Link>
                </motion.li>
              ))}
            </ul>
          )}
        </div>
        <aside className="min-w-0 space-y-8">
          <section aria-label="Evidence by type">
            <div className="micro mb-3">By type</div>
            <ul className="space-y-2">
              {byType.map(([t, n]) => (
                <li key={t}>
                  <button type="button" onClick={() => setType(type === t ? 'all' : (t as EvidenceType))} className="group w-full text-left">
                    <div className="flex items-baseline justify-between text-xs">
                      <span className={cx(type === t ? 'text-ink' : 'text-ink-2 group-hover:text-ink')}>{t.replace(/_/g, ' ').toLowerCase()}</span>
                      <span className="mono text-ink-3">{n}</span>
                    </div>
                    <div className="mt-1 h-[3px] rounded-full bg-s3">
                      <motion.div className="h-full origin-left rounded-full bg-violet/60" style={{ width: `${(n / max) * 100}%` }} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.5 }} />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section aria-label="Handling">
            <div className="micro mb-3">Handling</div>
            <ul className="space-y-2.5 text-xs text-ink-3">
              <li>File type is sniffed from the bytes, not trusted from the upload. PDF, PNG, JPEG and UTF-8 text are accepted.</li>
              <li>Restricted items are listed for everyone but readable only by PSIRT Lead, Security Manager, Compliance and Legal.</li>
              <li>Downloads are served as attachments with a sandboxing Content-Security-Policy, never from a public path.</li>
            </ul>
            <Badge tone="violet" className="mt-4">
              {all.filter((e) => e.classification === 'restricted').length} restricted
            </Badge>
          </section>
        </aside>
      </div>

      <Modal
        open={picking}
        onClose={() => setPicking(false)}
        title="Add evidence to a case"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPicking(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!target} onClick={() => navigate(`/cases/${target}?tab=evidence&add=1`)}>
              Continue
            </Button>
          </>
        }
      >
        <Field label="Case" hint="Evidence always belongs to a case, and can support only records in that case.">
          {(id) => (
            <Select id={id} value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Select a case</option>
              {(cases.data ?? []).filter((c) => c.lifecycle === 'open').map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id} · {c.title}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </Modal>
    </div>
  )
}
