import { Fragment, useState } from 'react'
import { Link, useParams } from 'react-router'
import { motion } from 'motion/react'
import { ArrowRight, CheckCircle2, Download, Laptop, Lock, RefreshCw, XCircle } from 'lucide-react'
import type { EvidenceChainNode } from '../../types/api.ts'
import { api, apiFetch, download } from '../../lib/client/api.ts'
import { useAction, useEvidenceItem, useUsers } from '../../lib/client/queries.ts'
import { bytes, stamp } from '../../lib/client/format.ts'
import { Button, Ident, KeyValue, SkeletonPage, cx } from '../../components/ui/primitives.tsx'
import { Badge } from '../../components/ui/status.tsx'
import { ErrorState, Notice } from '../../components/ui/feedback.tsx'

const KIND_LABEL: Record<EvidenceChainNode['kind'], string> = {
  evidence: 'Evidence',
  clock_event: 'Clock event',
  determination: 'Determination',
  decision: 'Decision',
  report: 'Report',
}

function nodeHref(n: EvidenceChainNode, caseId: string | null): string {
  if (n.kind === 'report') return `/reports/${n.id}`
  if (n.kind === 'evidence') return `/evidence/${n.id}`
  if (!caseId) return '/'
  return `/cases/${caseId}?tab=${n.kind === 'clock_event' ? 'clock' : n.kind === 'determination' ? 'products' : 'determination'}`
}

export function EvidenceDetail() {
  const { id = '' } = useParams()
  const q = useEvidenceItem(id)
  const users = useUsers()
  const [browserCheck, setBrowserCheck] = useState<{ ok: boolean; hash: string } | null>(null)
  const [checking, setChecking] = useState(false)
  const [verifyError, setVerifyError] = useState<unknown>(null)
  const verify = useAction(() => api<{ ok: boolean; observed: string | null; expected: string; checkedAt: string }>(`/api/evidence/${id}/verify`, { method: 'POST' }))
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  if (!q.data) return <SkeletonPage />
  const { evidence: e, chain, integrity, links, preview } = q.data
  const name = (uid: string) => users.data?.find((u) => u.id === uid)?.name ?? uid
  const image = e.mimeType === 'image/png' || e.mimeType === 'image/jpeg'

  const checkInBrowser = async () => {
    setChecking(true)
    setVerifyError(null)
    try {
      const res = await apiFetch(`/api/evidence/${id}/file`, { credentials: 'same-origin' })
      if (!res.ok) throw new Error(`Download refused (${res.status})`)
      const digest = await crypto.subtle.digest('SHA-256', await res.arrayBuffer())
      const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
      setBrowserCheck({ ok: hash === e.sha256, hash })
    } catch (err) {
      setVerifyError(err)
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="min-w-0 space-y-12">
      <header className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Ident className="text-[12.5px] text-violet">{e.id}</Ident>
          <Badge size="sm">{e.type.replace(/_/g, ' ')}</Badge>
          {e.classification === 'restricted' && (
            <Badge size="sm" tone="amber" icon={Lock}>
              Restricted
            </Badge>
          )}
        </div>
        <h1 className={cx('mt-4 text-2xl font-medium sm:text-3xl', e.redacted ? 'italic text-ink-3' : 'text-ink')}>{e.title}</h1>
        {e.description && <p className="mt-3 max-w-3xl text-md text-ink-2">{e.description}</p>}
        {e.redacted && (
          <Notice tone="amber" icon={Lock} className="mt-5 max-w-2xl" title="Content withheld">
            Your role cannot read restricted evidence. The record stays complete: its id, type and SHA-256 are shown, and it still counts toward the case's evidence.
          </Notice>
        )}
      </header>

      <section aria-labelledby="integrity-h" className={cx('min-w-0 rounded-xl border p-5 sm:p-7', integrity.ok ? 'border-green-line' : 'border-red')}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="micro mb-1.5">Integrity</div>
            <h2 id="integrity-h" className={cx('flex items-center gap-2.5 text-xl font-medium', integrity.ok ? 'text-green' : 'text-red')}>
              {integrity.ok ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
              {integrity.ok ? 'Integrity verified' : integrity.present ? 'Hash mismatch' : 'Stored object missing'}
            </h2>
            <p className="mt-1 text-xs text-ink-3">Server re-hashed the stored object at {stamp(integrity.checkedAt)}.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} busy={verify.isPending} onClick={() => void verify.mutateAsync(undefined).then(() => q.refetch())}>
              Re-verify on server
            </Button>
            {!e.redacted && e.hasFile && (
              <Button size="sm" icon={<Laptop className="h-3.5 w-3.5" />} busy={checking} onClick={() => void checkInBrowser()}>
                Verify in this browser
              </Button>
            )}
          </div>
        </div>
        <dl className="mt-6 grid min-w-0 gap-4">
          <div className="min-w-0">
            <dt className="micro mb-1">SHA-256 (recorded at upload)</dt>
            <dd className="ident text-[13px] text-ink">{e.sha256}</dd>
          </div>
          {integrity.observed && (
            <div className="min-w-0">
              <dt className="micro mb-1">SHA-256 (recomputed by server)</dt>
              <dd className={cx('ident text-[13px]', integrity.ok ? 'text-ink-2' : 'text-red')}>{integrity.observed}</dd>
            </div>
          )}
          {browserCheck && (
            <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="min-w-0">
              <dt className="micro mb-1">SHA-256 (recomputed in this browser from the downloaded bytes)</dt>
              <dd className={cx('ident text-[13px]', browserCheck.ok ? 'text-green' : 'text-red')}>
                {browserCheck.hash} {browserCheck.ok ? '· matches' : '· does not match'}
              </dd>
            </motion.div>
          )}
        </dl>
        {verifyError !== null && <ErrorState error={verifyError} className="mt-4" />}
      </section>

      <section aria-labelledby="chain-h" className="min-w-0">
        <div className="micro mb-1.5">Evidence chain</div>
        <h2 id="chain-h" className="mb-5 text-lg font-medium text-ink">
          What rests on this evidence
        </h2>
        {chain.length === 0 || (chain.length === 1 && chain[0]!.length === 1) ? (
          <p className="text-sm text-ink-3">Not linked to any record yet. Link it from the case's Evidence tab so the decision it supports can be traced back to it.</p>
        ) : (
          <div className="space-y-4">
            {chain.map((path, pi) => (
              <div key={pi} className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-stretch">
                {path.map((n, i) => (
                  <Fragment key={`${n.id}-${i}`}>
                    <motion.div initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: pi * 0.1 + i * 0.08 }} className="min-w-0 lg:w-56 lg:flex-none">
                      <Link to={nodeHref(n, e.caseId)} className={cx('block h-full rounded-lg border px-3.5 py-3 transition-colors hover:bg-s2', n.kind === 'evidence' ? 'border-violet-line' : 'border-line-strong')}>
                        <div className="micro">{KIND_LABEL[n.kind]}</div>
                        <div className={cx('ident mt-1 text-[13px]', n.kind === 'evidence' ? 'text-violet' : 'text-ink')}>{n.id}</div>
                        <div className="mt-1 line-clamp-2 text-[11.5px] text-ink-3">{n.label}</div>
                        {n.at && <div className="mono mt-1.5 text-[10.5px] text-ink-4">{stamp(n.at)}</div>}
                      </Link>
                    </motion.div>
                    {i < path.length - 1 && (
                      <div className="flex items-center justify-center text-ink-4" aria-hidden>
                        <ArrowRight className="h-4 w-4 rotate-90 lg:rotate-0" />
                      </div>
                    )}
                  </Fragment>
                ))}
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="grid min-w-0 gap-10 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <section aria-label="Metadata" className="min-w-0">
          <div className="micro mb-4">Record</div>
          <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
            <KeyValue label="Evidence ID" mono>
              {e.id}
            </KeyValue>
            <KeyValue label="Type">{e.type.replace(/_/g, ' ').toLowerCase()}</KeyValue>
            <KeyValue label="Source">{e.source}</KeyValue>
            <KeyValue label="Owner">{name(e.ownerId)}</KeyValue>
            <KeyValue label="Created at (per source)" mono>
              {e.sourceCreatedAt ? stamp(e.sourceCreatedAt) : '--'}
            </KeyValue>
            <KeyValue label="Uploaded at (server)" mono>
              {stamp(e.uploadedAt)}
            </KeyValue>
            <KeyValue label="Case" mono>
              {e.caseId ? <Link to={`/cases/${e.caseId}?tab=evidence`} className="hover:text-amber">{e.caseId}</Link> : '--'}
            </KeyValue>
            <KeyValue label="File" mono>
              {e.hasFile ? `${e.fileName ?? 'withheld'} · ${e.mimeType} · ${bytes(e.sizeBytes)}` : 'No file'}
            </KeyValue>
            <div className="sm:col-span-2">
              <dt className="micro mb-2">Linked records</dt>
              <dd className="flex flex-wrap gap-1.5">
                {links.length === 0 ? <span className="text-sm text-amber">None</span> : links.map((l) => <Badge key={`${l.targetType}-${l.targetId}`} size="sm">{`${l.targetType.replace(/_/g, ' ')} ${l.targetId}`}</Badge>)}
              </dd>
            </div>
          </dl>
          {!e.redacted && e.hasFile && (
            <Button className="mt-6" icon={<Download className="h-4 w-4" />} onClick={() => void download(`/api/evidence/${id}/file`, e.fileName ?? `${e.id}.bin`)}>
              Download (authorised)
            </Button>
          )}
        </section>
        <section aria-label="Preview" className="min-w-0">
          <div className="micro mb-4">Preview</div>
          {e.redacted ? (
            <div className="rounded-lg border border-dashed border-line-strong p-6 text-sm text-ink-3">Preview withheld for restricted evidence.</div>
          ) : image ? (
            <img src={`/api/evidence/${id}/file?inline=1`} alt={e.title} className="max-h-[520px] rounded-lg border border-line" />
          ) : preview !== null ? (
            <pre className="mono max-h-[520px] overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-s1 p-4 text-[12px] leading-relaxed text-ink-2 [overflow-wrap:anywhere]">{preview}</pre>
          ) : (
            <div className="rounded-lg border border-dashed border-line-strong p-6 text-sm text-ink-3">No inline preview for this file type. Download it to inspect.</div>
          )}
        </section>
      </div>
    </div>
  )
}
