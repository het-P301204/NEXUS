import fs from 'node:fs'
import { loadConfig } from '../server/config.ts'
import { openDb } from '../server/db.ts'
import { runIntegrityCheck, seedFresh } from '../server/bootstrap.ts'

/**
 * npm run db:reset -- delete the local database and evidence store and seed
 * the fictional demo organisation again, with times relative to now. Stop
 * the API server first: it holds the database open.
 */

const config = loadConfig([])
for (const f of [config.dbPath, `${config.dbPath}-wal`, `${config.dbPath}-shm`]) {
  if (fs.existsSync(f)) fs.rmSync(f)
}
if (fs.existsSync(config.evidenceDir)) fs.rmSync(config.evidenceDir, { recursive: true, force: true })
const db = openDb(config.dbPath)
await seedFresh(db, config, new Date())
const integrity = runIntegrityCheck(db, config)
db.close()
console.log(`Seeded ${config.dbPath}. ${integrity.detail}`)
