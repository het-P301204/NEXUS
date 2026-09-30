import { serve } from '@hono/node-server'
import { loadConfig } from './config.ts'
import { openDb, syncSequences } from './db.ts'
import { createApp } from './app.ts'
import { isSeeded, runIntegrityCheck, seedFresh } from './bootstrap.ts'
import type { Deps } from './context.ts'

/**
 * NEXUS API server.
 *
 *   node server/index.ts              development (Vite serves the UI on :5173)
 *   node server/index.ts --production serves the built UI from dist/ as well
 */

const config = loadConfig()
if (config.production && config.demoMode) {
  console.warn('[nexus] DEMO_MODE is on in production mode. Demo personas, scenarios and reset are enabled.')
}
const db = openDb(config.dbPath)
const deps: Deps = { db, config, now: () => new Date() }

if (!isSeeded(db)) {
  console.log('[nexus] empty database: seeding the fictional demo organisation')
  await seedFresh(db, config, new Date())
}
// Databases seeded before sequences were synchronised issue colliding ids.
syncSequences(db)
const integrity = runIntegrityCheck(db, config)
console.log(`[nexus] integrity: ${integrity.detail}`)

const app = createApp(deps)
serve({ fetch: app.fetch, port: config.port, hostname: '127.0.0.1' }, (info) => {
  console.log(`[nexus] API listening on http://127.0.0.1:${info.port}${config.production ? ' (production build)' : ''}`)
})
