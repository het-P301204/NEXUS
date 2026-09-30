import fs from 'node:fs'
import path from 'node:path'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { Deps, Env } from './context.ts'
import { ApiError } from './errors.ts'
import { accessLog, csrfCheck, originCheck, rateLimit, requestId, securityHeaders, sessionLoader } from './security.ts'
import { sessionRoutes } from './routes/session.ts'
import { caseRoutes } from './routes/cases.ts'
import { reportRoutes } from './routes/reports.ts'
import { evidenceRoutes } from './routes/evidence.ts'
import { portfolioRoutes } from './routes/portfolio.ts'
import { ledgerRoutes } from './routes/ledger.ts'
import { opsRoutes } from './routes/ops.ts'
import { importRoutes } from './routes/imports.ts'
import { demoRoutes } from './routes/demo.ts'

const STATIC_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
}

export function createApp(deps: Deps): Hono<Env> {
  const app = new Hono<Env>()

  app.use('*', requestId)
  app.use('*', accessLog(deps))
  app.use('*', securityHeaders(deps.config.production))
  app.use('*', rateLimit(deps))
  // JSON bodies are small; evidence uploads get their own, larger limit.
  app.use('/api/evidence', bodyLimit({ maxSize: deps.config.maxUploadBytes + 64 * 1024, onError: () => { throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Upload too large', `Evidence uploads are limited to ${Math.round(deps.config.maxUploadBytes / 1048576)} MiB.`) } }))
  app.use('/api/import/*', bodyLimit({ maxSize: 2_500_000, onError: () => { throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Import too large', 'Import files are limited to 2 MB.') } }))
  app.use('/api/*', async (c, next) => {
    if (c.req.path === '/api/evidence' || c.req.path.startsWith('/api/import/')) return next()
    return bodyLimit({ maxSize: 256 * 1024, onError: () => { throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request too large', 'Request bodies are limited to 256 KB.') } })(c, next)
  })
  app.use('*', originCheck(deps))
  app.use('*', sessionLoader(deps))
  app.use('*', csrfCheck)

  sessionRoutes(app, deps)
  caseRoutes(app, deps)
  reportRoutes(app, deps)
  evidenceRoutes(app, deps)
  portfolioRoutes(app, deps)
  ledgerRoutes(app, deps)
  opsRoutes(app, deps)
  importRoutes(app, deps)
  demoRoutes(app, deps)

  app.all('/api/*', (c) =>
    c.json({ error: { code: 'NOT_FOUND', title: 'No such endpoint', reason: `${c.req.method} ${c.req.path} is not part of the NEXUS API.` } }, 404),
  )

  // Production: serve the built frontend from dist/, with SPA fallback.
  if (deps.config.production) {
    const dist = path.resolve('dist')
    app.get('*', (c) => {
      const rel = decodeURIComponent(c.req.path).replace(/^\/+/, '')
      let file = path.resolve(dist, rel)
      if (!file.startsWith(dist + path.sep) && file !== dist) return c.text('Not found', 404)
      if (!rel || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html')
      if (!fs.existsSync(file)) return c.text('Build not found. Run npm run build first.', 503)
      const ext = path.extname(file)
      c.header('Content-Type', STATIC_TYPES[ext] ?? 'application/octet-stream')
      c.header('Cache-Control', rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache')
      return c.body(new Uint8Array(fs.readFileSync(file)))
    })
  }

  app.onError((err, c) => {
    const rid = c.get('requestId')
    if (err instanceof ApiError) {
      return c.json({ error: err.body(rid) }, err.status as 400)
    }
    // Never leak internals. Log them here, send a reference to the client.
    console.error(JSON.stringify({ t: deps.now().toISOString(), rid, level: 'error', path: c.req.path, message: err.message, stack: deps.config.production ? undefined : err.stack }))
    const append = /append-only/.test(err.message)
    return c.json(
      {
        error: {
          code: append ? 'HISTORY_IMMUTABLE' : 'INTERNAL_ERROR',
          title: append ? 'History cannot be edited' : 'Request not completed',
          reason: append
            ? 'The database refused to modify an append-only record. Record a correction instead.'
            : `The server could not complete the request. No change was saved. Reference ${rid}.`,
          requestId: rid,
        },
      },
      append ? 409 : 500,
    )
  })

  return app
}
