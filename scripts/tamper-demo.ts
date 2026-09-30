import { loadConfig } from '../server/config.ts'
import { openDb } from '../server/db.ts'
import { verifyLedger } from '../server/ledger.ts'

/**
 * npm run tamper-demo [-- --seq 40] [--rehash]
 *
 * Plays the attacker the application cannot stop: someone with write access
 * to the SQLite file. The append-only triggers stop every UPDATE the
 * application could issue, so this script first drops the trigger -- as an
 * attacker with the file could -- and then rewrites one ledger entry's summary
 * directly in the database.
 *
 *   default   the entry's content changes, its stored hash does not:
 *             verification reports hash_mismatch at that entry.
 *   --rehash  the attacker also recomputes that entry's hash:
 *             verification reports prev_link_mismatch at the NEXT entry.
 *
 * Then run "Verify ledger" in the UI, or let this script verify. To go back to
 * a clean ledger: npm run db:reset.
 *
 * This modifies your local demo database. It refuses to run unless DEMO_MODE
 * is on.
 */

const args = process.argv.slice(2)
const seqArg = args.indexOf('--seq')
const rehash = args.includes('--rehash')
const config = loadConfig([])
if (!config.demoMode) {
  console.error('Refusing: DEMO_MODE is off. This script exists to demonstrate tamper detection on demo data only.')
  process.exit(1)
}
const db = openDb(config.dbPath)
const head = db.prepare('SELECT MAX(seq) AS n FROM audit_events').get() as { n: number }
const seq = seqArg >= 0 ? Number(args[seqArg + 1]) : Math.max(1, Math.floor(head.n / 3))
const row = db.prepare('SELECT seq, data, prev_hash, hash FROM audit_events WHERE seq = ?').get(seq) as
  | { seq: number; data: string; prev_hash: string; hash: string }
  | undefined
if (!row) {
  console.error(`No ledger entry with seq ${seq}.`)
  process.exit(1)
}

const before = JSON.parse(row.data) as { summary: string }
const after = { ...before, summary: `${before.summary} [altered outside NEXUS]` }

db.exec('DROP TRIGGER IF EXISTS audit_events_append_only_update')
db.prepare('UPDATE audit_events SET data = ? WHERE seq = ?').run(JSON.stringify(after), seq)
if (rehash) {
  const { auditHashInput } = await import('../lib/engine/ledger.ts')
  const { sha256Hex } = await import('../server/hash.ts')
  const entry = { ...(after as object), seq } as unknown as Parameters<typeof auditHashInput>[1]
  db.prepare('UPDATE audit_events SET hash = ? WHERE seq = ?').run(sha256Hex(auditHashInput(row.prev_hash, entry)), seq)
}
// Restore the trigger so the application's own protection is back in place.
db.exec(`CREATE TRIGGER IF NOT EXISTS audit_events_append_only_update BEFORE UPDATE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit_events is append-only: record a correction instead of editing history'); END;`)

const result = await verifyLedger(db)
db.close()
console.log(`Altered entry seq ${seq}${rehash ? ' and recomputed its hash' : ''}.`)
console.log(`  before: ${before.summary}`)
console.log(`  after:  ${after.summary}`)
console.log(result.ok ? 'Verification: OK (unexpected)' : `Verification: INTEGRITY EXCEPTION at ${result.firstBreak?.id} (${result.firstBreak?.kind})`)
if (result.firstBreak) {
  console.log(`  expected ${result.firstBreak.expectedHash}`)
  console.log(`  observed ${result.firstBreak.observedHash}`)
}
console.log('Open the Audit Ledger and run "Verify ledger" to see it in the UI. Restore with: npm run db:reset')
