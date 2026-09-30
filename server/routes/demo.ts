import type { Hono } from 'hono'
import { deleteCookie } from 'hono/cookie'
import { SCENARIOS } from '../../data/scenarios.ts'
import type { Deps, Env } from '../context.ts'
import { requirePermission, requireUser } from '../context.ts'
import { applyTriggers } from '../db.ts'
import { notFound } from '../errors.ts'
import { resetDemo, runIntegrityCheck, runScenario } from '../bootstrap.ts'
import { sessionCookieName } from '../security.ts'

/**
 * Demo controls. Every route here returns 404 unless DEMO_MODE=true: a
 * production deployment has no scenario simulator and no reset path.
 */
export function demoRoutes(app: Hono<Env>, deps: Deps): void {
  const { db, config } = deps

  app.get('/api/demo/scenarios', (c) => {
    requireUser(c)
    if (!config.demoMode) throw notFound('Resource', 'scenarios')
    return c.json({ scenarios: SCENARIOS })
  })

  app.post('/api/demo/scenarios/:id', async (c) => {
    requirePermission(c, 'demo.control')
    if (!config.demoMode) throw notFound('Resource', 'scenarios')
    const def = SCENARIOS.find((s) => s.id === c.req.param('id'))
    if (!def) throw notFound('Scenario', c.req.param('id'))
    if (!def.createsCase) return c.json({ caseId: null, tab: def.tab })
    const caseId = await runScenario(db, config, deps.now(), def.id)
    return c.json({ caseId, tab: def.tab }, 201)
  })

  app.post('/api/demo/reset', async (c) => {
    requirePermission(c, 'demo.control')
    if (!config.demoMode) throw notFound('Resource', 'reset')
    await resetDemo(db, config, deps.now(), () => applyTriggers(db))
    runIntegrityCheck(db, config)
    // Every session was removed with the data; the browser signs in again.
    deleteCookie(c, sessionCookieName(config.production), { path: '/', secure: config.production })
    return c.json({ ok: true, signInRequired: true })
  })
}
