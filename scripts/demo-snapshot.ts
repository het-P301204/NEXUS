import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Config } from '../server/config.ts'
import type { Deps } from '../server/context.ts'
import { openDb, syncSequences } from '../server/db.ts'
import { createApp } from '../server/app.ts'
import { runIntegrityCheck, seedFresh } from '../server/bootstrap.ts'
import type { DemoFile, DemoSnapshot } from '../lib/client/static-demo.ts'

/**
 * npm run build:pages  (runs this after `vite build --mode pages`)
 *
 *   node scripts/demo-snapshot.ts [--out dist]
 *
 * Records the static demo. Seeds the real server in memory exactly as a first
 * start would, signs in as the PSIRT Lead persona, and saves every response
 * the UI reads -- lists, every detail page, analytics ranges -- to
 * <out>/demo/snapshot.json, and every download to <out>/demo/files.json. The
 * static build answers its /api requests from those files
 * (lib/client/static-demo.ts). It also copies index.html to 404.html, which is
 * how GitHub Pages serves deep links into a single-page app.
 *
 * Nothing is committed: the snapshot is rebuilt on every Pages deploy, so it
 * always matches the code it is served with, and its clocks start at the
 * moment of the build.
 */

process.env.NEXUS_QUIET = '1'

const args = process.argv.slice(2)
const outArg = args.indexOf('--out')
const outDir = path.resolve(outArg >= 0 && args[outArg + 1] ? args[outArg + 1]! : 'dist')
const PERSONA = 'u-lead'
const ORIGIN = 'http://localhost:5173'

if (!fs.existsSync(path.join(outDir, 'index.html'))) {
  console.error(`No ${path.join(outDir, 'index.html')}. Build the static site first: vite build --mode pages`)
  process.exit(1)
}

const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-pages-'))
const config: Config = {
  production: false,
  port: 8787,
  appOrigin: ORIGIN,
  demoMode: true,
  storageDir,
  dbPath: ':memory:',
  evidenceDir: path.join(storageDir, 'evidence'),
  maxUploadBytes: 10 * 1024 * 1024,
  sessionTtlMs: 8 * 3600_000,
  sessionIdleMs: 8 * 3600_000,
  // Several hundred reads in a second or two; the limits are for people.
  rateLimitScale: 1000,
}

// One fixed instant for the seed and every response, so all the recorded
// "now"s agree. seedFresh works in whole seconds; so does this.
const now = new Date(Math.floor(Date.now() / 1000) * 1000)
const db = openDb(':memory:')
await seedFresh(db, config, now)
syncSequences(db)
runIntegrityCheck(db, config)
const deps: Deps = { db, config, now: () => now }
const app = createApp(deps)

const login = await app.request('http://localhost/api/session/persona', {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: ORIGIN },
  body: JSON.stringify({ userId: PERSONA }),
})
if (login.status !== 200) throw new Error(`persona sign-in failed: ${login.status} ${await login.text()}`)
const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]!
const get = (p: string) => app.request(`http://localhost${p}`, { headers: { cookie, accept: 'application/json' } })

const responses: Record<string, unknown> = {}
const files: Record<string, DemoFile> = {}

async function read<T>(p: string): Promise<T> {
  const res = await get(p)
  if (res.status !== 200) throw new Error(`GET ${p} answered ${res.status}: ${await res.text()}`)
  const body = (await res.json()) as T
  responses[p] = body
  return body
}

async function file(p: string): Promise<void> {
  const res = await get(p)
  if (res.status !== 200) throw new Error(`GET ${p} answered ${res.status}: ${await res.text()}`)
  const bytes = Buffer.from(await res.arrayBuffer())
  files[p] = {
    type: res.headers.get('content-type') ?? 'application/octet-stream',
    disposition: res.headers.get('content-disposition'),
    base64: bytes.toString('base64'),
  }
}

const enc = encodeURIComponent
type Listed = { id: string }

// Reads ---------------------------------------------------------------------------------
const session = await read<{ csrfToken: string }>('/api/session')
// The token belongs to a session that ends with this script; nothing checks it.
session.csrfToken = 'static-demo'
await read('/api/session/personas')
const ledgerBefore = await read<{ head: { seq: number } }>('/api/ledger')
for (const p of ['/api/overview', '/api/users', '/api/components', '/api/graph', '/api/rules', '/api/notifications', '/api/settings', '/api/system/status', '/api/demo/scenarios', '/api/determinations', '/api/clocks']) {
  await read(p)
}
for (const range of ['7d', '30d', '90d', 'all']) await read(`/api/analytics?range=${range}`)

const cases = (await read<{ items: Listed[] }>('/api/cases')).items
for (const c of cases) await read(`/api/cases/${enc(c.id)}`)
const products = (await read<{ items: Listed[] }>('/api/products')).items
for (const p of products) await read(`/api/products/${enc(p.id)}`)
const vulns = (await read<{ items: Listed[] }>('/api/vulnerabilities')).items
for (const v of vulns) await read(`/api/vulnerabilities/${enc(v.id)}`)
const evidence = (await read<{ items: Array<Listed & { hasFile: boolean; redacted?: boolean }> }>('/api/evidence')).items
for (const e of evidence) await read(`/api/evidence/${enc(e.id)}`)
const reports = (await read<{ reports: Listed[] }>('/api/reports')).reports
for (const r of reports) await read(`/api/reports/${enc(r.id)}`)

// Reading must not have written: the recorded ledger is the whole ledger.
const ledgerAfter = await read<{ head: { seq: number } }>('/api/ledger')
if (ledgerAfter.head.seq !== ledgerBefore.head.seq) {
  throw new Error(`the ledger grew from ${ledgerBefore.head.seq} to ${ledgerAfter.head.seq} while recording reads`)
}

// Downloads -----------------------------------------------------------------------------
// Last, because an export may itself be recorded on the ledger. The anchor goes
// first so it names the head of the ledger the snapshot holds.
await file('/api/ledger/anchor')
for (const e of evidence) if (e.hasFile && !e.redacted) await file(`/api/evidence/${e.id}/file`)
for (const r of reports) for (const f of ['html', 'md', 'json']) await file(`/api/reports/${r.id}/export?format=${f}`)
for (const c of cases) {
  await file(`/api/cases/${c.id}/export`)
  await file(`/api/cases/${c.id}/vex`)
}
for (const f of ['csv', 'json']) await file(`/api/export/cases?format=${f}`)

db.close()
fs.rmSync(storageDir, { recursive: true, force: true })

const snapshot: DemoSnapshot = { version: 1, capturedAt: now.toISOString(), personaId: PERSONA, responses, files: Object.keys(files) }
const target = path.join(outDir, 'demo', 'snapshot.json')
const filesTarget = path.join(outDir, 'demo', 'files.json')
fs.mkdirSync(path.dirname(target), { recursive: true })
fs.writeFileSync(target, JSON.stringify(snapshot))
fs.writeFileSync(filesTarget, JSON.stringify(files))
fs.copyFileSync(path.join(outDir, 'index.html'), path.join(outDir, '404.html'))

const kb = (n: number) => `${Math.round(n / 1024)} KB`
console.log(
  `[nexus] static demo recorded at ${snapshot.capturedAt}: ${Object.keys(responses).length} responses, ${Object.keys(files).length} downloads, ` +
    `${cases.length} cases, ledger head ${ledgerAfter.head.seq}; ${path.relative(process.cwd(), target)} ${kb(fs.statSync(target).size)}, ` +
    `${path.relative(process.cwd(), filesTarget)} ${kb(fs.statSync(filesTarget).size)}`,
)
