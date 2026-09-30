import { useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import { Link } from 'react-router'
import { useMutation } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { AlertOctagon, AlertTriangle, ArrowRight, CheckCircle2, Download, Eraser, FileDown, FileText, Lock, ShieldCheck, Upload } from 'lucide-react'
import type { ImportPreview } from '../../types/api.ts'
import { api, download } from '../../lib/client/api.ts'
import { useAction } from '../../lib/client/queries.ts'
import { useSession } from '../../lib/client/session.tsx'
import { bytes, hhmm } from '../../lib/client/format.ts'
import { ROLES, ROLE_ORDER, can as roleCan } from '../../lib/rbac.ts'
import { Button, PageHeader, Panel, Segmented, TextArea, cx } from '../../components/ui/primitives.tsx'
import { Badge } from '../../components/ui/status.tsx'
import { ErrorState, Notice } from '../../components/ui/feedback.tsx'
import { useToast } from '../../components/ui/overlay.tsx'

/**
 * Import and export. An import is validated in full before anything is
 * written (preview), then committed all-or-nothing in one transaction with
 * one ledger entry. Exports are plain downloads of the case register.
 */

type Kind = ImportPreview['kind']
type Format = ImportPreview['format']

const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_CHARS = 2_000_000
const PREVIEW_TTL_MS = 10 * 60_000
const ROW_LIMIT = 25

const KINDS: Array<{ value: Kind; label: string; noun: [string, string]; href: string; hrefLabel: string }> = [
  { value: 'vulnerabilities', label: 'Vulnerabilities', noun: ['vulnerability', 'vulnerabilities'], href: '/vulnerabilities', hrefLabel: 'Open vulnerabilities' },
  { value: 'products', label: 'Products', noun: ['product', 'products'], href: '/products', hrefLabel: 'Open products' },
  { value: 'components', label: 'Component mappings', noun: ['component mapping', 'component mappings'], href: '/products', hrefLabel: 'Open products' },
]

const SAMPLES: Record<Kind, Partial<Record<Format, string>>> = {
  vulnerabilities: { csv: 'vulnerabilities.csv', json: 'vulnerabilities.json' },
  products: { json: 'products.json' },
  components: { csv: 'components.csv' },
}

interface FieldDoc {
  csv: string
  json: string
  required?: boolean
  note: string
}

const FIELDS: Record<Kind, FieldDoc[]> = {
  vulnerabilities: [
    { csv: 'cve', json: 'cve', note: 'CVE-2026-12345. Optional; without it the record is tracked by its internal id.' },
    { csv: 'title', json: 'title', required: true, note: 'Up to 200 characters.' },
    { csv: 'cwe', json: 'cwe', note: 'CWE-787.' },
    { csv: 'cvss_score', json: 'cvssScore', note: '0 to 10, one decimal.' },
    { csv: 'cvss_vector', json: 'cvssVector', note: 'CVSS:3.1/AV:N/AC:L/...' },
    { csv: 'severity', json: 'severity', required: true, note: 'CRITICAL, HIGH, MEDIUM or LOW. A mismatch with the CVSS score is a warning.' },
    { csv: 'description', json: 'description', required: true, note: 'At least 10 characters.' },
    { csv: 'component', json: 'component', note: 'Package URL or name from the component register.' },
    { csv: 'affected_versions', json: 'affectedVersions', required: true, note: '">=3.0.0 <3.0.14", alternatives with "||".' },
    { csv: 'fixed_version', json: 'fixedVersion', note: 'First fixed version.' },
    { csv: 'exploitability', json: 'exploitability', note: 'Free text.' },
    { csv: 'exploitation', json: 'exploitation', note: 'CONFIRMED, SUSPECTED, NOT_OBSERVED or UNKNOWN (default).' },
    { csv: 'source', json: 'source', required: true, note: 'Where the record came from.' },
    { csv: 'discovered_at', json: 'discoveredAt', required: true, note: 'ISO-8601 with an explicit offset, e.g. 2026-09-30T08:31:22Z.' },
    { csv: 'vendor_advisory', json: 'vendorAdvisory', note: 'URL.' },
  ],
  products: [
    { csv: 'id', json: 'id', required: true, note: 'PRD- followed by 2 to 12 capitals or digits.' },
    { csv: 'name', json: 'name', required: true, note: 'Up to 120 characters.' },
    { csv: 'version', json: 'version', required: true, note: 'Shipped version.' },
    { csv: 'lifecycle', json: 'lifecycle', required: true, note: 'active, maintenance or end_of_support.' },
    { csv: 'owner_id', json: 'ownerId', required: true, note: 'A user id, e.g. u-eng.' },
    { csv: 'description', json: 'description', note: 'Up to 2,000 characters.' },
    { csv: 'sbom_status', json: 'sbomStatus', required: true, note: 'current, stale or missing. Anything but current is a warning.' },
    { csv: 'sbom_generated_at', json: 'sbomGeneratedAt', note: 'ISO-8601 with an explicit offset.' },
    { csv: 'environment', json: 'environment', required: true, note: 'Where it runs.' },
    { csv: 'exposure', json: 'exposure', required: true, note: 'internet_facing, customer_network, internal or isolated.' },
    { csv: 'made_available_in_eu', json: 'madeAvailableInEu', required: true, note: 'true or false.' },
  ],
  components: [
    { csv: 'product_id', json: 'productId', required: true, note: 'An existing product, e.g. PRD-SEG3.' },
    { csv: 'name', json: 'name', required: true, note: 'Component name.' },
    { csv: 'purl', json: 'purl', required: true, note: 'pkg:generic/openssl. A new purl adds a component (warning).' },
    { csv: 'ecosystem', json: 'ecosystem', required: true, note: 'e.g. C / system, Maven.' },
    { csv: 'supplier', json: 'supplier', required: true, note: 'Upstream supplier.' },
    { csv: 'version', json: 'version', required: true, note: 'Version shipped in the product.' },
    { csv: 'relation', json: 'relation', note: 'direct (default) or transitive.' },
    { csv: 'usage', json: 'usage', note: 'How the product uses it.' },
  ],
}

function listPhrase(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

function plural(n: number, noun: [string, string]): string {
  return `${n.toLocaleString('en')} ${n === 1 ? noun[0] : noun[1]}`
}

interface Snapshot {
  kind: Kind
  format: Format
  content: string
  at: number
}

export function ImportExport() {
  const { can } = useSession()
  const allowed = can('import.commit')
  const importers = listPhrase(ROLE_ORDER.filter((r) => roleCan(r, 'import.commit')).map((r) => ROLES[r].label))
  const toast = useToast()

  const [kind, setKind] = useState<Kind>('vulnerabilities')
  const [format, setFormat] = useState<Format>('csv')
  const [content, setContent] = useState('')
  const [source, setSource] = useState<{ name: string; size: number; sample: boolean } | null>(null)
  const [inputError, setInputError] = useState<string | null>(null)
  const [sampleBusy, setSampleBusy] = useState<Format | null>(null)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [committed, setCommitted] = useState<{ kind: Kind; imported: number; ids: string[] } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const preview = useMutation({
    mutationFn: (body: { kind: Kind; format: Format; content: string }) => api<ImportPreview>('/api/import/preview', { body }),
  })
  const commit = useAction((token: string) => api<{ imported: number; ids: string[] }>('/api/import/commit', { body: { token } }))

  const result = preview.data ?? null
  const stale = !!(result && snapshot && (snapshot.kind !== kind || snapshot.format !== format || snapshot.content !== content))

  const resetResults = () => {
    preview.reset()
    commit.reset()
    setSnapshot(null)
  }

  // A different kind or format, or a newly loaded file, starts a fresh preview;
  // editing the text in place keeps the old one, marked stale.
  const changeKind = (k: Kind) => {
    setKind(k)
    const available = SAMPLES[k]
    if (!available[format]) setFormat(available.csv ? 'csv' : 'json')
    setCommitted(null)
    resetResults()
  }

  const changeFormat = (f: Format) => {
    setFormat(f)
    resetResults()
  }

  const setText = (text: string, from: { name: string; size: number; sample: boolean } | null) => {
    setContent(text)
    setSource(from)
    setInputError(null)
    setCommitted(null)
  }

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const ext = file.name.toLowerCase().split('.').pop() ?? ''
    if (!['csv', 'json', 'txt'].includes(ext)) {
      setInputError(`${file.name} is not a .csv, .json or .txt file.`)
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      setInputError(`${file.name} is ${bytes(file.size)}. Imports are limited to ${bytes(MAX_FILE_BYTES)} per file; split it and import the parts.`)
      return
    }
    try {
      const text = await file.text()
      if (ext === 'json') setFormat('json')
      else if (ext === 'csv') setFormat('csv')
      setText(text, { name: file.name, size: file.size, sample: false })
      resetResults()
    } catch {
      setInputError(`${file.name} could not be read as text.`)
    }
  }

  const loadSample = async (f: Format) => {
    const name = SAMPLES[kind][f]
    if (!name) return
    setSampleBusy(f)
    try {
      const res = await fetch(`/samples/${name}`, { credentials: 'same-origin' })
      if (!res.ok) throw new Error(String(res.status))
      const text = await res.text()
      setFormat(f)
      setText(text, { name, size: new Blob([text]).size, sample: true })
      resetResults()
    } catch {
      setInputError(`The sample file ${name} could not be loaded from /samples/. Check that the web server serves the public directory.`)
    } finally {
      setSampleBusy(null)
    }
  }

  const validate = () => {
    if (!content.trim()) {
      setInputError('Paste the file content or upload a file first.')
      return
    }
    if (content.length > MAX_CHARS) {
      setInputError(`The content is ${content.length.toLocaleString('en')} characters; the limit is ${MAX_CHARS.toLocaleString('en')}.`)
      return
    }
    setInputError(null)
    setCommitted(null)
    commit.reset()
    const snap: Snapshot = { kind, format, content, at: Date.now() }
    preview.mutate({ kind, format, content }, { onSuccess: () => setSnapshot(snap) })
  }

  const doCommit = () => {
    if (!result || !result.canCommit || stale) return
    const k = snapshot?.kind ?? kind
    commit.mutate(result.token, {
      onSuccess: (res) => {
        setCommitted({ kind: k, imported: res.imported, ids: res.ids })
        preview.reset()
        setSnapshot(null)
        const noun = KINDS.find((x) => x.value === k)!.noun
        toast({ tone: 'success', title: `Imported ${plural(res.imported, noun)}`, body: 'One IMPORT_COMMITTED entry was written to the audit ledger.' })
      },
      onError: (e) => toast({ tone: 'error', title: 'Import not committed', body: e.message }),
    })
  }

  const lines = content ? content.split(/\r\n|\r|\n/).filter((l) => l.trim()).length : 0

  return (
    <div className="min-w-0">
      <PageHeader
        eyebrow="Data"
        title="Import & export"
        description="Bring vulnerabilities, products and component mappings in from structured files, and take the case register out. Every import is validated in full before anything is written, and a commit writes every record or none."
      />

      {/* Import --------------------------------------------------------------------- */}
      <section aria-labelledby="import-heading" className="min-w-0">
        <div className="mb-5 flex min-w-0 flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="micro mb-2">Import</div>
            <h2 id="import-heading" className="text-xl font-medium text-ink">
              Validate, then commit
            </h2>
          </div>
          {!allowed && (
            <Badge tone="dim" icon={Lock}>
              Read only for your role
            </Badge>
          )}
        </div>

        {!allowed && (
          <Notice tone="neutral" icon={Lock} className="mb-5">
            Your role cannot import. Validating and committing both need the import permission, held by {importers}. You can still read the field reference and load a sample.
          </Notice>
        )}

        <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_340px] xl:gap-10">
          <Panel className="min-w-0 self-start">
            <div className="space-y-7 p-5 sm:p-6">
              <Step n="01" label="What are you importing">
                <Segmented label="Record kind" value={kind} onChange={changeKind} options={KINDS.map((k) => ({ value: k.value, label: k.label }))} />
              </Step>
              <Step n="02" label="Format">
                <div className="flex min-w-0 flex-wrap items-center gap-3">
                  <Segmented
                    label="Format"
                    value={format}
                    onChange={changeFormat}
                    options={[
                      { value: 'csv', label: 'CSV' },
                      { value: 'json', label: 'JSON' },
                    ]}
                  />
                  <span className="text-xs text-ink-3">{format === 'csv' ? 'Header row first; columns in any order.' : `An array, or an object with a "${kind}" array.`}</span>
                </div>
              </Step>
              <Step n="03" label="Content">
                <div className="mb-3 flex min-w-0 flex-wrap items-center gap-2">
                  <input ref={fileRef} type="file" accept=".csv,.json,.txt" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void onFile(e)} />
                  <Button size="sm" variant="secondary" icon={<Upload className="h-3.5 w-3.5" />} onClick={() => fileRef.current?.click()}>
                    Upload file
                  </Button>
                  {(['csv', 'json'] as const).map((f) =>
                    SAMPLES[kind][f] ? (
                      <Button key={f} size="sm" variant="ghost" icon={<FileText className="h-3.5 w-3.5" />} busy={sampleBusy === f} onClick={() => void loadSample(f)}>
                        Load {f.toUpperCase()} sample
                      </Button>
                    ) : null,
                  )}
                  {content && (
                    <Button
                      size="sm"
                      variant="quiet"
                      icon={<Eraser className="h-3.5 w-3.5" />}
                      onClick={() => {
                        setText('', null)
                        resetResults()
                      }}
                    >
                      Clear
                    </Button>
                  )}
                </div>
                <TextArea
                  aria-label="Import content"
                  value={content}
                  onChange={(e) => setText(e.target.value, source ? { ...source, sample: false, name: `${source.name} (edited)` } : null)}
                  spellCheck={false}
                  wrap="off"
                  placeholder={format === 'csv' ? FIELDS[kind].map((f) => f.csv).join(',') : `{ "${kind}": [ { ... } ] }`}
                  rows={12}
                  style={{ minHeight: 260 }}
                  className="font-mono text-[12px] leading-[1.6]"
                />
                <div className="mt-2 flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-ink-3">
                  <span className="min-w-0">
                    {source ? (
                      <>
                        <span className="ident text-ink-2">{source.name}</span>
                        {source.sample && <span className="ml-2">Fictional sample</span>}
                      </>
                    ) : content ? (
                      'Pasted content'
                    ) : (
                      'Paste CSV or JSON, or upload a .csv, .json or .txt file up to 2 MB.'
                    )}
                  </span>
                  {content && (
                    <span className="mono">
                      {lines.toLocaleString('en')} lines · {content.length.toLocaleString('en')} chars
                    </span>
                  )}
                </div>
                {inputError && (
                  <p className="mt-3 flex items-start gap-2 text-sm text-red" role="alert">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {inputError}
                  </p>
                )}
              </Step>
            </div>
            <div className="flex flex-col gap-3 border-t border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <p className="text-xs text-ink-3">Validation writes nothing. It returns every valid record, warning and error, row by row.</p>
              <Button variant="primary" icon={<ShieldCheck className="h-3.5 w-3.5" />} onClick={validate} busy={preview.isPending} disabled={!allowed || !content.trim()}>
                Validate
              </Button>
            </div>
          </Panel>

          <FieldReference kind={kind} format={format} />
        </div>

        {preview.error && <ErrorState error={preview.error} className="mt-6" />}

        {committed && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-6">
            <Notice tone="green" icon={CheckCircle2} title={`Imported ${plural(committed.imported, KINDS.find((k) => k.value === committed.kind)!.noun)}`}>
              <p>Every record was written in one transaction, with one IMPORT_COMMITTED entry in the audit ledger carrying the SHA-256 of the file content.</p>
              {committed.ids.length > 0 && (
                <ul className="mt-3 flex min-w-0 flex-wrap gap-1.5" aria-label="Imported record ids">
                  {committed.ids.map((id) => (
                    <li key={id} className="inline-flex h-6 items-center rounded-md border border-green-line bg-s1 px-2 font-mono text-[11.5px] text-ink">
                      <span className="ident">{id}</span>
                    </li>
                  ))}
                </ul>
              )}
              <Link to={KINDS.find((k) => k.value === committed.kind)!.href} className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-ink hover:text-green">
                {KINDS.find((k) => k.value === committed.kind)!.hrefLabel} <ArrowRight className="h-3 w-3" aria-hidden />
              </Link>
            </Notice>
          </motion.div>
        )}

        {result && snapshot && (
          <PreviewView
            result={result}
            snapshot={snapshot}
            stale={stale}
            noun={KINDS.find((k) => k.value === snapshot.kind)!.noun}
            canCommit={allowed && result.canCommit && !stale}
            committing={commit.isPending}
            commitError={commit.error}
            onCommit={doCommit}
            onRevalidate={validate}
          />
        )}
        {!result && commit.error && <ErrorState error={commit.error} onRetry={validate} className="mt-6" />}
      </section>

      <ExportSection />
    </div>
  )
}

function Step({ n, label, children }: { n: string; label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-3 sm:grid-cols-[40px_minmax(0,1fr)] sm:gap-4">
      <span className="mono hidden pt-0.5 text-xs text-ink-3 sm:block" aria-hidden>
        {n}
      </span>
      <div className="min-w-0">
        <div className="mb-2.5 text-sm font-medium text-ink">
          <span className="mono mr-2 text-xs text-ink-3 sm:hidden" aria-hidden>
            {n}
          </span>
          {label}
        </div>
        {children}
      </div>
    </div>
  )
}

function FieldList({ kind, format }: { kind: Kind; format: Format }) {
  return (
    <ul className="divide-y divide-line">
      {FIELDS[kind].map((f) => (
        <li key={f.csv} className="min-w-0 py-2">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="ident text-[12px] text-ink">{format === 'csv' ? f.csv : f.json}</span>
            {f.required && <span className="micro text-amber">Required</span>}
          </div>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-3">{f.note}</p>
        </li>
      ))}
    </ul>
  )
}

function FieldReference({ kind, format }: { kind: Kind; format: Format }) {
  const title = `${format === 'csv' ? 'Columns' : 'Keys'} · ${KINDS.find((k) => k.value === kind)!.label}`
  return (
    <>
      <aside className="hidden min-w-0 xl:block" aria-label="Field reference">
        <div className="micro mb-2">{title}</div>
        <p className="mb-2 text-xs text-ink-3">{format === 'csv' ? 'Snake-case column names, matched case-insensitively.' : 'camelCase keys; snake_case is accepted too.'} Up to 500 records per file.</p>
        <FieldList kind={kind} format={format} />
      </aside>
      <details className="group min-w-0 rounded-xl border border-line xl:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3.5 text-sm text-ink-2 hover:text-ink">
          <span className="micro">{title}</span>
          <ArrowRight className="h-3.5 w-3.5 text-ink-3 transition-transform duration-150 group-open:rotate-90" aria-hidden />
        </summary>
        <div className="border-t border-line px-5 pb-3 pt-2">
          <p className="mb-1 text-xs text-ink-3">{format === 'csv' ? 'Snake-case column names, matched case-insensitively.' : 'camelCase keys; snake_case is accepted too.'} Up to 500 records per file.</p>
          <FieldList kind={kind} format={format} />
        </div>
      </details>
    </>
  )
}

// Preview -------------------------------------------------------------------------------

function PreviewView({
  result,
  snapshot,
  stale,
  noun,
  canCommit,
  committing,
  commitError,
  onCommit,
  onRevalidate,
}: {
  result: ImportPreview
  snapshot: Snapshot
  stale: boolean
  noun: [string, string]
  canCommit: boolean
  committing: boolean
  commitError: Error | null
  onCommit: () => void
  onRevalidate: () => void
}) {
  const total = result.valid.length + result.errors.length
  const csv = result.format === 'csv'
  const expires = new Date(snapshot.at + PREVIEW_TTL_MS).toISOString()
  return (
    <motion.section initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }} aria-label="Validation result" className="mt-8 min-w-0">
      <div className="mb-4 flex min-w-0 flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="micro mb-1.5">Validation result</div>
          <p className="text-sm text-ink-2">
            {plural(total, noun)} read from {result.format.toUpperCase()}.{csv ? ' Row numbers count records; the header is line 1, so row 1 is on line 2.' : ' Row numbers count array items from 1.'}
          </p>
        </div>
        <span className="mono text-xs text-ink-3">Preview expires {hhmm(expires)}</span>
      </div>

      <dl className="grid min-w-0 grid-cols-3 border-y border-line">
        {[
          { k: 'Valid', v: result.valid.length, tone: 'text-green', icon: CheckCircle2 },
          { k: 'Warnings', v: result.warnings.length, tone: 'text-amber', icon: AlertTriangle },
          { k: 'Errors', v: result.errors.length, tone: 'text-red', icon: AlertOctagon },
        ].map((x, i) => (
          <div key={x.k} className={cx('min-w-0 py-4', i > 0 && 'border-l border-line pl-4 sm:pl-6')}>
            <dt className={cx('flex items-center gap-1.5 font-mono text-micro uppercase', x.v > 0 ? x.tone : 'text-ink-3')}>
              <x.icon className="h-3.5 w-3.5" aria-hidden /> {x.k}
            </dt>
            <dd className={cx('mono mt-1 text-2xl tabular sm:text-3xl', x.v > 0 ? 'text-ink' : 'text-ink-3')}>{x.v}</dd>
          </div>
        ))}
      </dl>

      {stale && (
        <Notice tone="amber" icon={AlertTriangle} title="Content changed after validation" className="mt-5">
          The kind, format or content no longer matches what was validated. Validate again before committing.
          <div className="mt-2">
            <Button size="sm" variant="secondary" onClick={onRevalidate}>
              Validate again
            </Button>
          </div>
        </Notice>
      )}
      {result.errors.length > 0 && (
        <Notice tone="red" icon={AlertOctagon} title="Nothing will be imported" className="mt-5">
          The preview found {result.errors.length === 1 ? 'one error' : `${result.errors.length} errors`}. Fix {result.errors.length === 1 ? 'it' : 'them'} in the file and validate again. Nothing is imported until every record is valid, including the {plural(result.valid.length, noun)} that passed.
        </Notice>
      )}

      <div className="mt-6 grid min-w-0 gap-8 lg:grid-cols-3 lg:gap-6">
        <Group
          title="Valid records"
          tone="green"
          icon={CheckCircle2}
          empty="No record passed validation."
          items={result.valid.map((v) => ({ row: v.row, body: <Summary text={v.summary} /> }))}
          csv={csv}
        />
        <Group title="Warnings" tone="amber" icon={AlertTriangle} empty="No warnings." items={result.warnings.map((w) => ({ row: w.row, body: w.message }))} csv={csv} />
        <Group title="Errors" tone="red" icon={AlertOctagon} empty="No errors." items={result.errors.map((e) => ({ row: e.row, body: e.message }))} csv={csv} />
      </div>

      <div className="mt-8 flex min-w-0 flex-col gap-3 border-t border-line pt-5 sm:flex-row sm:items-center">
        <Button variant="primary" icon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={onCommit} disabled={!canCommit} busy={committing}>
          Commit {plural(result.valid.length, noun)}
        </Button>
        <p className="text-sm text-ink-2">All-or-nothing: nothing is imported unless every record is valid.</p>
      </div>
      {commitError && <ErrorState error={commitError} onRetry={onRevalidate} className="mt-5" />}
    </motion.section>
  )
}

function Summary({ text }: { text: string }) {
  const [head, ...rest] = text.split(' -- ')
  return (
    <>
      <span className="ident text-[12.5px] text-ink">{head}</span>
      {rest.length > 0 && <span className="text-ink-2"> {rest.join(' -- ')}</span>}
    </>
  )
}

function Group({ title, tone, icon: Icon, items, empty, csv }: { title: string; tone: 'green' | 'amber' | 'red'; icon: typeof CheckCircle2; items: Array<{ row: number; body: ReactNode }>; empty: string; csv: boolean }) {
  const [all, setAll] = useState(false)
  const shown = all ? items : items.slice(0, ROW_LIMIT)
  const text = { green: 'text-green', amber: 'text-amber', red: 'text-red' }[tone]
  const rule = { green: 'border-green-line', amber: 'border-amber-line', red: 'border-red-line' }[tone]
  return (
    <div className="min-w-0">
      <h3 className={cx('flex items-center gap-2 border-b-2 pb-2 font-mono text-micro uppercase', items.length ? `${rule} ${text}` : 'border-line text-ink-3')}>
        <Icon className="h-3.5 w-3.5" aria-hidden /> {title}
        <span className="ml-auto tabular text-ink-3">{items.length}</span>
      </h3>
      {items.length === 0 ? (
        <p className="py-3 text-sm text-ink-3">{empty}</p>
      ) : (
        <ul className="divide-y divide-line">
          {shown.map((it, i) => (
            <li key={`${it.row}-${i}`} className="grid min-w-0 grid-cols-[64px_minmax(0,1fr)] gap-3 py-2.5">
              <span className="min-w-0">
                <span className={cx('mono block text-xs', text)}>Row {it.row}</span>
                {csv && <span className="mono block text-[10.5px] text-ink-3">line {it.row + 1}</span>}
              </span>
              <span className="min-w-0 text-sm leading-relaxed text-ink-2">{it.body}</span>
            </li>
          ))}
        </ul>
      )}
      {items.length > ROW_LIMIT && (
        <Button size="sm" variant="quiet" className="mt-1" onClick={() => setAll((v) => !v)}>
          {all ? `Show first ${ROW_LIMIT}` : `Show all ${items.length}`}
        </Button>
      )}
    </div>
  )
}

// Export ----------------------------------------------------------------------------------

function ExportSection() {
  const toast = useToast()
  const [busy, setBusy] = useState<'csv' | 'json' | null>(null)
  const [error, setError] = useState<unknown>(null)

  const run = async (f: 'csv' | 'json') => {
    setBusy(f)
    setError(null)
    try {
      await download(`/api/export/cases?format=${f}`, `cases.${f}`)
      toast({ tone: 'success', title: `Case register exported as ${f.toUpperCase()}` })
    } catch (e) {
      setError(e)
    } finally {
      setBusy(null)
    }
  }

  const rows: Array<{ f: 'csv' | 'json'; title: string; body: string }> = [
    { f: 'csv', title: 'Cases CSV', body: 'One row per case: status, lifecycle, products, owner, affectedness, next deadline, evidence completeness and health.' },
    { f: 'json', title: 'Cases JSON', body: 'The same register with its full structure, the export time and the rule-set version the analysis ran under.' },
  ]

  return (
    <section aria-labelledby="export-heading" className="mt-16 min-w-0 border-t border-line pt-10">
      <div className="micro mb-2">Export</div>
      <h2 id="export-heading" className="text-xl font-medium text-ink">
        Case register
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-ink-2">Every case in the register, as analysed at the moment of export.</p>

      <ul className="mt-6 border-t border-line">
        {rows.map((r) => (
          <li key={r.f} className="grid min-w-0 gap-3 border-b border-line py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-8">
            <div className="flex min-w-0 items-start gap-3">
              <FileDown className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden />
              <div className="min-w-0">
                <div className="text-sm text-ink">{r.title}</div>
                <p className="mt-0.5 max-w-2xl text-sm text-ink-3">{r.body}</p>
              </div>
            </div>
            <Button variant="secondary" icon={<Download className="h-3.5 w-3.5" />} busy={busy === r.f} disabled={busy !== null && busy !== r.f} onClick={() => void run(r.f)} className="justify-self-start">
              Download {r.f.toUpperCase()}
            </Button>
          </li>
        ))}
      </ul>
      {error !== null && <ErrorState error={error} className="mt-5" />}

      <div className="mt-6 grid min-w-0 gap-4 md:grid-cols-2 md:gap-8">
        <p className="flex min-w-0 items-start gap-2.5 text-xs leading-relaxed text-ink-3">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-3" aria-hidden />
          <span>
            CSV cells are protected against spreadsheet formula injection. Every cell is quoted, a cell that begins with = + - @, a tab or a carriage return is prefixed with an apostrophe so a spreadsheet reads it as text, and invisible and bidirectional control characters are removed.
          </span>
        </p>
        <p className="flex min-w-0 items-start gap-2.5 text-xs leading-relaxed text-ink-3">
          <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-3" aria-hidden />
          <span>Per-case records, VEX documents and reports are exported from each case page and report page. A case record export carries that case&apos;s ledger entries and the rule-set version it was analysed under.</span>
        </p>
      </div>
    </section>
  )
}
