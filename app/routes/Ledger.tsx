import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { AlertOctagon, Anchor, Download, FlaskConical, Laptop, ShieldCheck, Upload } from 'lucide-react'
import type { ChainVerification } from '../../lib/engine/ledger.ts'
import { verifyChain, webCryptoSha256 } from '../../lib/engine/ledger.ts'
import type { TamperSimulationResponse, VerifyResponse } from '../../types/api.ts'
import { api, ApiFailure, download } from '../../lib/client/api.ts'
import { useAction, useLedger, useUsers } from '../../lib/client/queries.ts'
import { useSession } from '../../lib/client/session.tsx'
import { short, stamp } from '../../lib/client/format.ts'
import { Button, Field, Hash, Ident, PageHeader, Select, SkeletonPage, TextInput, cx } from '../../components/ui/primitives.tsx'
import { ErrorState, Notice } from '../../components/ui/feedback.tsx'
import { Badge } from '../../components/ui/status.tsx'
import { ChainEntry } from '../../components/ledger/ChainEntry.tsx'

function ResultPanel({ result, at, label, simulation }: { result: ChainVerification; at: string; label: string; simulation?: TamperSimulationResponse['target'] }) {
  const ok = result.ok
  const b = result.firstBreak
  return (
    <motion.section
      initial={{ opacity: 0, y: 8, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      aria-live="polite"
      className={cx('min-w-0 rounded-xl border p-5 sm:p-7', ok ? 'border-green-line bg-green/[0.04]' : 'border-red bg-red/[0.06]')}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="micro">
          {label} · {stamp(at)}
        </div>
        {simulation && (
          <Badge tone="violet" icon={FlaskConical}>
            Demo / simulation
          </Badge>
        )}
      </div>
      <div className={cx('mt-4 flex items-center gap-4', ok ? 'text-green' : 'text-red')}>
        {ok ? <ShieldCheck className="h-9 w-9 shrink-0" strokeWidth={1.4} /> : <AlertOctagon className="h-9 w-9 shrink-0" strokeWidth={1.4} />}
        <div className="text-2xl font-medium uppercase tracking-[0.03em] sm:text-3xl">{ok ? 'Ledger integrity verified' : 'Integrity exception detected'}</div>
      </div>
      <p className="mt-3 text-sm text-ink-2">
        {ok
          ? `${result.checked} entries recomputed from genesis. Every stored hash matches its content and every previous-hash link matches the entry before it.`
          : `${result.checked} entries checked. ${result.breaks.length} break${result.breaks.length > 1 ? 's' : ''} found; the first is shown.`}
        {result.anchor && (result.anchor.matched ? ` The exported anchor at entry ${result.anchor.seq} matches.` : ` The exported anchor at entry ${result.anchor.seq} does NOT match: the chain was rewritten after the anchor was taken.`)}
      </p>
      {ok ? (
        <dl className="mt-5 grid gap-x-8 gap-y-3 sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="micro mb-1">Head</dt>
            <dd className="ident text-sm text-ink">seq {result.headSeq}</dd>
          </div>
          <div className="min-w-0">
            <dt className="micro mb-1">Head hash</dt>
            <dd>
              <Hash value={result.headHash} length={20} />
            </dd>
          </div>
        </dl>
      ) : (
        b && (
          <dl className="mt-6 grid min-w-0 gap-x-8 gap-y-4 border-t border-red-line pt-5 sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="micro mb-1">Affected event</dt>
              <dd className="ident text-lg text-ink">{b.id}</dd>
            </div>
            <div className="min-w-0">
              <dt className="micro mb-1">Chain broken at</dt>
              <dd className="ident text-lg text-red">
                {b.id} <span className="text-sm text-ink-3">({b.kind.replace(/_/g, ' ')})</span>
              </dd>
            </div>
            {b.expectedHash && (
              <div className="min-w-0 sm:col-span-2">
                <dt className="micro mb-1">Expected hash</dt>
                <dd className="ident text-[12.5px] text-ink">{b.expectedHash}</dd>
              </div>
            )}
            {b.observedHash && (
              <div className="min-w-0 sm:col-span-2">
                <dt className="micro mb-1">Observed hash</dt>
                <dd className="ident text-[12.5px] text-red">{b.observedHash}</dd>
              </div>
            )}
            <p className="text-xs text-ink-2 sm:col-span-2">{b.explanation}</p>
            {simulation && (
              <div className="min-w-0 rounded-lg border border-line bg-s1 px-4 py-3 sm:col-span-2">
                <div className="micro mb-2">Simulated alteration of {simulation.id} · field: {simulation.field}</div>
                <div className="text-xs text-ink-3">Original</div>
                <div className="ident mt-0.5 text-[12px] text-ink-2">{simulation.original}</div>
                <div className="mt-2 text-xs text-ink-3">Altered</div>
                <div className="ident mt-0.5 text-[12px] text-red">{simulation.altered}</div>
              </div>
            )}
          </dl>
        )
      )}
    </motion.section>
  )
}

export function Ledger() {
  const q = useLedger()
  const users = useUsers()
  const { can, demoMode } = useSession()
  const [params, setParams] = useSearchParams()
  const [server, setServer] = useState<VerifyResponse | null>(null)
  const [browser, setBrowser] = useState<{ result: ChainVerification; at: string } | null>(null)
  const [sim, setSim] = useState<TamperSimulationResponse | null>(null)
  const [simSeq, setSimSeq] = useState('')
  const [simField, setSimField] = useState<'summary' | 'actor' | 'timestamp' | 'payload'>('summary')
  const [browserBusy, setBrowserBusy] = useState(false)
  const [anchorText, setAnchorText] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [limit, setLimit] = useState(60)
  const [filter, setFilter] = useState('')
  const verify = useAction((anchor: { seq: number; hash: string } | null) => api<VerifyResponse>('/api/ledger/verify', { body: { anchor } }))
  const simulate = useAction((b: { seq: number; field: string }) => api<TamperSimulationResponse>('/api/demo/ledger/simulate', { body: b }))
  const simRef = useRef<HTMLDivElement>(null)
  const name = (id: string) => users.data?.find((u) => u.id === id)?.name ?? id

  const runServer = async (anchor: { seq: number; hash: string } | null = null) => {
    setError(null)
    try {
      setServer(await verify.mutateAsync(anchor))
      setSim(null)
    } catch (e) {
      setError(e)
    }
  }
  useEffect(() => {
    if (params.get('verify') === '1' && can('ledger.verify')) {
      void runServer()
      setParams({}, { replace: true })
    }
    if (params.get('simulate') === '1') setTimeout(() => simRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 400)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const entries = useMemo(() => q.data?.entries ?? [], [q.data])
  useEffect(() => {
    if (!simSeq && entries.length > 3) setSimSeq(String(entries[Math.floor(entries.length / 3)]!.seq))
  }, [entries, simSeq])

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase()
    const list = [...entries].reverse().filter((e) => !f || [e.id, e.eventType, e.summary, e.caseId, e.objectId].some((x) => x?.toLowerCase().includes(f)))
    return list
  }, [entries, filter])

  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  if (!q.data) return <SkeletonPage />
  const head = q.data.head
  const last = q.data.lastVerification
  const brokenSeq = sim ? sim.result.firstBreak?.seq : (server && !server.result.ok ? server.result.firstBreak?.seq : undefined)
  const brokenKind = sim ? sim.result.firstBreak?.kind : server?.result.firstBreak?.kind

  const runBrowser = async () => {
    setBrowserBusy(true)
    try {
      const fresh = await q.refetch()
      const result = await verifyChain(fresh.data?.entries ?? entries, webCryptoSha256)
      setBrowser({ result, at: new Date().toISOString() })
    } finally {
      setBrowserBusy(false)
    }
  }

  return (
    <div className="min-w-0">
      <PageHeader
        eyebrow="Record"
        title="Audit ledger"
        description="Every change NEXUS makes is appended here and chained by SHA-256: each entry's hash covers its content and the hash of the entry before it. The database rejects edits and deletions; the chain exposes anyone who goes around the database."
      />

      <section className="grid min-w-0 gap-6 border-y border-line py-6 sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-line">
        <div className="min-w-0">
          <div className="micro mb-2">Entries</div>
          <div className="mono text-3xl text-ink">{head.seq}</div>
        </div>
        <div className="min-w-0 lg:pl-6">
          <div className="micro mb-2">Head hash</div>
          <Hash value={head.hash} length={16} />
          <div className="mono mt-1 text-[11px] text-ink-3">{head.at ? short(head.at) : '--'}</div>
        </div>
        <div className="min-w-0 lg:pl-6">
          <div className="micro mb-2">Last verification</div>
          {last ? (
            <>
              <div className={cx('text-sm', last.ok ? 'text-green' : 'text-red')}>{last.ok ? 'Verified' : 'Integrity exception'}</div>
              <div className="mono mt-1 text-[11px] text-ink-3">
                {short(last.at)} · by {name(last.actorId)}
              </div>
            </>
          ) : (
            <div className="text-sm text-amber">Never verified</div>
          )}
        </div>
        <div className="flex min-w-0 flex-wrap items-start gap-2 lg:justify-end lg:pl-6">
          <Button variant="primary" size="lg" icon={<ShieldCheck className="h-4 w-4" />} busy={verify.isPending} onClick={() => void runServer()} disabled={!can('ledger.verify')}>
            Verify ledger
          </Button>
        </div>
      </section>

      <div className="mt-8 min-w-0 space-y-6">
        {error !== null && <ErrorState error={error} />}
        <AnimatePresence>{server && <ResultPanel key={server.verifiedAt} result={server.result} at={server.verifiedAt} label="Server verification" />}</AnimatePresence>
      </div>

      <div className="mt-12 grid min-w-0 gap-10 xl:grid-cols-2">
        <section aria-labelledby="indep-h" className="min-w-0">
          <div className="micro mb-1.5">Independent verification</div>
          <h2 id="indep-h" className="text-lg font-medium text-ink">
            Verify in this browser
          </h2>
          <p className="mt-2 text-sm text-ink-3">Recomputes every hash with the browser's own Web Crypto, from the raw entries, without relying on the server's answer.</p>
          <Button className="mt-4" icon={<Laptop className="h-4 w-4" />} busy={browserBusy} onClick={() => void runBrowser()}>
            Verify in this browser
          </Button>
          {browser && (
            <div className="mt-5">
              <ResultPanel result={browser.result} at={browser.at} label="Browser verification" />
            </div>
          )}
        </section>
        <section aria-labelledby="anchor-h" className="min-w-0">
          <div className="micro mb-1.5">External anchor</div>
          <h2 id="anchor-h" className="text-lg font-medium text-ink">
            Hold a head hash outside NEXUS
          </h2>
          <p className="mt-2 text-sm text-ink-3">
            Someone with write access to the database file could rewrite the whole chain from a tampered entry onwards. An anchor exported now and kept elsewhere cannot be reproduced by a rewritten chain.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button icon={<Download className="h-4 w-4" />} onClick={() => void download('/api/ledger/anchor', 'nexus-ledger-anchor.json')}>
              Download anchor
            </Button>
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-line-strong bg-s3 px-3.5 text-sm text-ink hover:bg-s4">
              <Upload className="h-4 w-4" /> Load anchor file
              <input type="file" accept=".json" className="sr-only" onChange={async (e) => setAnchorText((await e.target.files?.[0]?.text()) ?? '')} />
            </label>
          </div>
          {anchorText && (
            <div className="mt-4 rounded-lg border border-line bg-s1 p-4">
              {(() => {
                try {
                  const a = JSON.parse(anchorText) as { seq: number; hash: string; at?: string }
                  if (typeof a.seq !== 'number' || !/^[0-9a-f]{64}$/.test(a.hash)) throw new Error('bad')
                  return (
                    <>
                      <div className="flex items-center gap-2 text-sm text-ink">
                        <Anchor className="h-4 w-4 text-violet" /> Anchor at entry <span className="mono">{a.seq}</span>
                      </div>
                      <Hash value={a.hash} length={20} className="mt-1" />
                      <Button size="sm" className="mt-3" onClick={() => void runServer({ seq: a.seq, hash: a.hash })} busy={verify.isPending}>
                        Verify against this anchor
                      </Button>
                    </>
                  )
                } catch {
                  return <p className="text-xs text-red">This file is not a NEXUS ledger anchor (expected seq and a 64-character hex hash).</p>
                }
              })()}
            </div>
          )}
        </section>
      </div>

      {demoMode && (
        <section ref={simRef} aria-labelledby="sim-h" className="mt-14 min-w-0 rounded-xl border border-dashed border-violet-line p-5 sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="micro mb-1.5 text-violet">Demo / simulation</div>
              <h2 id="sim-h" className="text-lg font-medium text-ink">
                Integrity simulation: tamper with one entry
              </h2>
            </div>
            <Badge tone="violet" icon={FlaskConical}>
              Stored ledger is not modified
            </Badge>
          </div>
          <p className="mt-2 max-w-3xl text-sm text-ink-3">
            The server copies the ledger into memory, alters one field of one entry in the copy, and verifies the copy. The real table cannot be changed from here: it rejects updates. To tamper with the real database file the way an attacker with file access could, run <span className="mono text-ink-2">npm run tamper-demo</span>.
          </p>
          <div className="mt-5 flex flex-wrap items-end gap-3">
            <Field label="Entry" className="w-40">
              {(id) => <TextInput id={id} type="number" min={1} max={head.seq} value={simSeq} onChange={(e) => setSimSeq(e.target.value)} />}
            </Field>
            <Field label="Field to alter" className="w-52">
              {(id) => (
                <Select id={id} value={simField} onChange={(e) => setSimField(e.target.value as typeof simField)}>
                  <option value="summary">Summary text</option>
                  <option value="actor">Actor</option>
                  <option value="timestamp">Timestamp (−6h)</option>
                  <option value="payload">Payload</option>
                </Select>
              )}
            </Field>
            <Button
              variant="primary"
              icon={<FlaskConical className="h-4 w-4" />}
              busy={simulate.isPending}
              disabled={!simSeq}
              onClick={async () => {
                setError(null)
                try {
                  setSim(await simulate.mutateAsync({ seq: Number(simSeq), field: simField }))
                } catch (e) {
                  setError(e instanceof ApiFailure ? e : e)
                }
              }}
            >
              Simulate tampered event
            </Button>
          </div>
          {sim && (
            <div className="mt-6">
              <ResultPanel result={sim.result} at={new Date().toISOString()} label="Simulated verification" simulation={sim.target} />
              <Notice tone="neutral" className="mt-4">
                The chain view below marks the broken entry. Run "Verify ledger" at the top to confirm the stored ledger is still intact.
              </Notice>
            </div>
          )}
        </section>
      )}

      <section aria-labelledby="chain-h" className="mt-14 min-w-0">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="micro mb-1.5">Chain</div>
            <h2 id="chain-h" className="text-lg font-medium text-ink">
              Newest first · each link points at the one below it
            </h2>
          </div>
          <TextInput value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by id, type, case" className="w-64" aria-label="Filter ledger" />
        </div>
        <ol className="min-w-0 max-w-5xl">
          {shown.slice(0, limit).map((e, i) => (
            <ChainEntry key={e.seq} e={e} name={name} index={i} broken={brokenSeq === e.seq ? (brokenKind ?? null) : null} verified={!!server?.result.ok || !!browser?.result.ok} />
          ))}
        </ol>
        {shown.length > limit && (
          <Button variant="ghost" className="mt-2" onClick={() => setLimit((l) => l + 100)}>
            Show {Math.min(100, shown.length - limit)} more ({shown.length - limit} remaining)
          </Button>
        )}
        <div className="mt-4 flex items-center gap-3 pl-[44px] text-xs text-ink-3">
          <Ident dim className="text-[11px]">
            genesis
          </Ident>
          <span>previous hash of the first entry is 64 zeros</span>
        </div>
      </section>
    </div>
  )
}
