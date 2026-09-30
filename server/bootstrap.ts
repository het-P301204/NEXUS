import fs from 'node:fs'
import type { Config } from './config.ts'
import type { Db } from './db.ts'
import { SCHEMA_VERSION, getMeta, setMeta, setSequence, syncSequences } from './db.ts'
import { createSeeder } from './seeder.ts'
import { seedDemo, DEMO_START_SEQUENCES } from '../data/demo-cases.ts'
import { scheduleScenario } from '../data/scenarios.ts'
import { USERS } from '../data/portfolio.ts'
import { verifyObject } from './evidence-store.ts'
import { listEvidence } from './repo.ts'

const TABLES = [
  'audit_events',
  'notifications',
  'comments',
  'reviews',
  'report_transitions',
  'reports',
  'evidence_links',
  'evidence',
  'decisions',
  'determinations',
  'clock_events',
  'case_review_markers',
  'case_relations',
  'cases',
  'threat_intel',
  'vulnerabilities',
  'deployments',
  'product_components',
  'products',
  'components',
  'escalation_rules',
  'criteria',
  'sessions',
  'users',
  'organization',
  'sequences',
  'meta',
]

export function isSeeded(db: Db): boolean {
  const row = db.prepare('SELECT COUNT(*) AS n FROM organization').get() as { n: number }
  return row.n > 0
}

export async function seedFresh(db: Db, config: Config, at: Date): Promise<void> {
  // Whole seconds, so relative demo times do not carry a stray millisecond fraction.
  const now = new Date(Math.floor(at.getTime() / 1000) * 1000)
  for (const [prefix, value] of Object.entries(DEMO_START_SEQUENCES)) setSequence(db, prefix, value)
  const s = createSeeder({ db, config, now })
  seedDemo(s, now.getTime(), process.env.DEMO_PASSWORD ? process.env.DEMO_PASSWORD : null)
  await s.run({ verifyAt: now.getTime() - 40 * 60_000, verifier: 'u-ro' })
  syncSequences(db)
  setMeta(db, 'seeded_at', now.toISOString())
  setMeta(db, 'schema_version', String(SCHEMA_VERSION))
  setMeta(db, 'scenario_count', '0')
}

/**
 * DEMO MODE ONLY. The one code path that removes history: it drops the
 * append-only triggers, empties every table, restores the triggers and
 * re-seeds. The route that calls it does not exist when DEMO_MODE=false.
 */
export async function resetDemo(db: Db, config: Config, now: Date, recreateTriggers: () => void): Promise<void> {
  const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all() as Array<{ name: string }>
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const t of triggers) db.exec(`DROP TRIGGER IF EXISTS ${t.name}`)
    for (const table of TABLES) db.exec(`DELETE FROM ${table}`)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  recreateTriggers()
  if (fs.existsSync(config.evidenceDir)) fs.rmSync(config.evidenceDir, { recursive: true, force: true })
  await seedFresh(db, config, now)
}

export async function runScenario(db: Db, config: Config, now: Date, id: string): Promise<string> {
  const n = Number(getMeta(db, 'scenario_count') ?? '0') + 1
  setMeta(db, 'scenario_count', String(n))
  const s = createSeeder({ db, config, now, source: 'demo', recordingJitter: false })
  s.knownUsers(USERS)
  const key = scheduleScenario(s, id, now.getTime(), n)
  await s.run()
  return s.ref(key)
}

/** Database and evidence-store integrity, recorded for the system-status panel. */
export function runIntegrityCheck(db: Db, config: Config): { ok: boolean; detail: string } {
  const pragma = db.prepare('PRAGMA integrity_check').get() as Record<string, string>
  const dbOk = Object.values(pragma)[0] === 'ok'
  const evidence = listEvidence(db).filter((e) => e.hasFile)
  const bad = evidence.filter((e) => !verifyObject(config.evidenceDir, e.sha256).ok)
  const ok = dbOk && bad.length === 0
  const detail = ok
    ? `Database integrity ok; ${evidence.length} evidence objects match their SHA-256.`
    : !dbOk
      ? 'SQLite integrity_check reported a problem.'
      : `${bad.length} evidence object(s) missing or not matching their SHA-256: ${bad.slice(0, 3).map((e) => e.id).join(', ')}.`
  setMeta(db, 'integrity_check', JSON.stringify({ ok, detail }))
  return { ok, detail }
}
