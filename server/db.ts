import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

/**
 * SQLite through node:sqlite -- no native module to compile, one file on disk.
 *
 * Each table holds the domain object as JSON in `data`, alongside the columns
 * that queries and foreign keys need. Tables that hold history are
 * append-only, and the database enforces it: an UPDATE or DELETE on them
 * aborts inside SQLite, whatever the application code tries. The hash chain
 * in the audit ledger then covers the case the triggers cannot: someone
 * editing the database file directly.
 */

export type Db = DatabaseSync

export const SCHEMA_VERSION = 3

const APPEND_ONLY = [
  'clock_events',
  'determinations',
  'decisions',
  'evidence',
  'evidence_links',
  'reports',
  'report_transitions',
  'reviews',
  'comments',
  'threat_intel',
  'audit_events',
]

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sequences (prefix TEXT PRIMARY KEY, value INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS organization (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL,
  password_hash TEXT,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  csrf_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS components (id TEXT PRIMARY KEY, purl TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS product_components (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  component_id TEXT NOT NULL REFERENCES components(id),
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS vulnerabilities (
  id TEXT PRIMARY KEY,
  cve TEXT,
  component_id TEXT REFERENCES components(id),
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS threat_intel (
  id TEXT PRIMARY KEY,
  vulnerability_id TEXT NOT NULL REFERENCES vulnerabilities(id),
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  vulnerability_id TEXT NOT NULL REFERENCES vulnerabilities(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  lifecycle TEXT NOT NULL,
  created_at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS case_relations (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id),
  related_case_id TEXT NOT NULL REFERENCES cases(id),
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS case_review_markers (
  user_id TEXT NOT NULL REFERENCES users(id),
  case_id TEXT NOT NULL REFERENCES cases(id),
  reviewed_at TEXT NOT NULL,
  ledger_seq INTEGER NOT NULL,
  PRIMARY KEY (user_id, case_id)
);

CREATE TABLE IF NOT EXISTS clock_events (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id),
  type TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS determinations (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  recorded_at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id),
  decided_at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  case_id TEXT REFERENCES cases(id),
  sha256 TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS evidence_links (
  evidence_id TEXT NOT NULL REFERENCES evidence(id),
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  PRIMARY KEY (evidence_id, target_type, target_id)
);
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id),
  kind TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS report_transitions (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES reports(id),
  at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id),
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id),
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  read_at TEXT,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS criteria (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS escalation_rules (id TEXT PRIMARY KEY, data TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS audit_events (
  seq INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  at TEXT NOT NULL,
  case_id TEXT,
  event_type TEXT NOT NULL,
  data TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_case ON clock_events(case_id);
CREATE INDEX IF NOT EXISTS idx_det_case ON determinations(case_id);
CREATE INDEX IF NOT EXISTS idx_dec_case ON decisions(case_id);
CREATE INDEX IF NOT EXISTS idx_evidence_case ON evidence(case_id);
CREATE INDEX IF NOT EXISTS idx_links_target ON evidence_links(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_reports_case ON reports(case_id);
CREATE INDEX IF NOT EXISTS idx_audit_case ON audit_events(case_id);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id);
`

function triggers(): string {
  return APPEND_ONLY.map(
    (t) => `
CREATE TRIGGER IF NOT EXISTS ${t}_append_only_update BEFORE UPDATE ON ${t}
BEGIN SELECT RAISE(ABORT, '${t} is append-only: record a correction instead of editing history'); END;
CREATE TRIGGER IF NOT EXISTS ${t}_append_only_delete BEFORE DELETE ON ${t}
BEGIN SELECT RAISE(ABORT, '${t} is append-only: history is never deleted'); END;`,
  ).join('\n')
}

export function applyTriggers(db: Db): void {
  db.exec(triggers())
}

export function openDb(file: string): Db {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec('PRAGMA busy_timeout = 3000;')
  db.exec(SCHEMA)
  applyTriggers(db)
  db.prepare('INSERT OR IGNORE INTO meta(key, value) VALUES (?, ?)').run('schema_version', String(SCHEMA_VERSION))
  return db
}

/** Run fn in an IMMEDIATE transaction; roll back on any throw. */
export function tx<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const out = fn()
    db.exec('COMMIT')
    return out
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

export function getMeta(db: Db, key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setMeta(db: Db, key: string, value: string): void {
  db.prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}

/** Next value of a named sequence, formatted with the prefix: CASE-2026-0041. */
export function nextId(db: Db, prefix: string, pad = 4): string {
  const row = db
    .prepare(
      'INSERT INTO sequences(prefix, value) VALUES (?, 1) ON CONFLICT(prefix) DO UPDATE SET value = value + 1 RETURNING value',
    )
    .get(prefix) as { value: number }
  return `${prefix}-${String(row.value).padStart(pad, '0')}`
}

export function setSequence(db: Db, prefix: string, value: number): void {
  db.prepare('INSERT INTO sequences(prefix, value) VALUES (?, ?) ON CONFLICT(prefix) DO UPDATE SET value = excluded.value').run(
    prefix,
    value,
  )
}

/**
 * Advance every id sequence past the highest id already stored under its
 * prefix. Seed data carries fixed ids (PC-0001, DEP-0001, ...); without this
 * the first id the API issues under that prefix collides with one of them, and
 * the insert fails every time because the rollback rewinds the sequence too.
 */
export function syncSequences(db: Db): void {
  const highest = new Map<string, number>()
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>
  for (const { name } of tables) {
    const columns = db.prepare(`PRAGMA table_info("${name}")`).all() as Array<{ name: string }>
    if (!columns.some((c) => c.name === 'id')) continue
    for (const row of db.prepare(`SELECT id FROM "${name}"`).all() as Array<{ id: unknown }>) {
      const m = typeof row.id === 'string' ? /^([A-Z][A-Z0-9-]*?)-(\d+)$/.exec(row.id) : null
      if (m) highest.set(m[1]!, Math.max(highest.get(m[1]!) ?? 0, Number(m[2])))
    }
  }
  const bump = db.prepare('INSERT INTO sequences(prefix, value) VALUES (?, ?) ON CONFLICT(prefix) DO UPDATE SET value = MAX(value, excluded.value)')
  for (const [prefix, value] of highest) bump.run(prefix, value)
}

// JSON-row helpers ----------------------------------------------------------

export function parseRows<T>(rows: unknown[]): T[] {
  return rows.map((r) => JSON.parse((r as { data: string }).data) as T)
}

export function getOne<T>(db: Db, table: string, id: string): T | null {
  const row = db.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(id) as { data: string } | undefined
  return row ? (JSON.parse(row.data) as T) : null
}

export function all<T>(db: Db, table: string, where = '', ...params: Array<string | number | null>): T[] {
  return parseRows<T>(db.prepare(`SELECT data FROM ${table} ${where}`).all(...params))
}
