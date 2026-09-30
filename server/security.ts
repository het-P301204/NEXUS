import type { MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import type { Deps, Env } from './context.ts'
import { ApiError } from './errors.ts'
import { resolveSession, safeEqual } from './auth.ts'
import { randomToken } from './hash.ts'

/**
 * HTTP security middleware, in the order it runs:
 *
 *   requestId -> securityHeaders -> rateLimit -> originCheck -> session -> csrf
 *
 * Everything that refuses a request throws an ApiError, which the error
 * handler turns into a structured body without internal detail.
 */

export function sessionCookieName(production: boolean): string {
  // __Host- requires Secure, which a plain-http dev server cannot set.
  return production ? '__Host-nexus' : 'nexus_sid'
}

export const requestId: MiddlewareHandler<Env> = async (c, next) => {
  c.set('requestId', randomToken(9))
  c.set('user', null)
  c.set('session', null)
  await next()
}

/**
 * Content-Security-Policy for the built app. No inline script, no eval, no
 * third-party origin: fonts are self-hosted and every request goes to 'self'.
 * `style-src 'unsafe-inline'` is required by the animation library, which
 * writes computed transforms to element style attributes; it carries numbers,
 * never user text.
 */
export const APP_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ')

export function securityHeaders(production: boolean): MiddlewareHandler<Env> {
  return async (c, next) => {
    await next()
    const h = c.res.headers
    h.set('X-Content-Type-Options', 'nosniff')
    h.set('X-Frame-Options', 'DENY')
    h.set('Referrer-Policy', 'no-referrer')
    h.set('Cross-Origin-Opener-Policy', 'same-origin')
    h.set('Cross-Origin-Resource-Policy', 'same-origin')
    h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()')
    if (!h.has('Content-Security-Policy')) h.set('Content-Security-Policy', APP_CSP)
    if (c.req.path.startsWith('/api/') && !h.has('Cache-Control')) h.set('Cache-Control', 'no-store')
    if (production) h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
}

// Rate limiting ---------------------------------------------------------------

interface Bucket {
  count: number
  resetAt: number
}

const LIMITS = {
  auth: { max: 10, windowMs: 60_000 },
  upload: { max: 20, windowMs: 60_000 },
  write: { max: 120, windowMs: 60_000 },
  read: { max: 900, windowMs: 60_000 },
} as const

export function rateLimit(deps: Deps): MiddlewareHandler<Env> {
  const buckets = new Map<string, Bucket>()
  return async (c, next) => {
    if (!c.req.path.startsWith('/api/')) return next()
    const method = c.req.method
    const path = c.req.path
    // Exact paths: listing personas (/api/session/personas) is a read, not a sign-in attempt.
    const kind: keyof typeof LIMITS = (path === '/api/session/login' || path === '/api/session/persona') && method === 'POST'
      ? 'auth'
      : path === '/api/evidence' && method === 'POST'
        ? 'upload'
        : method === 'GET' || method === 'HEAD'
          ? 'read'
          : 'write'
    // Behind a proxy, set the address from a trusted header at the proxy, not here.
    const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming
    const ip = incoming?.socket?.remoteAddress ?? 'local'
    const key = `${ip}:${kind}`
    const now = deps.now().getTime()
    const limit = { max: LIMITS[kind].max * deps.config.rateLimitScale, windowMs: LIMITS[kind].windowMs }
    let b = buckets.get(key)
    if (!b || now >= b.resetAt) {
      b = { count: 0, resetAt: now + limit.windowMs }
      buckets.set(key, b)
    }
    b.count++
    if (buckets.size > 10_000) {
      for (const [k, v] of buckets) if (now >= v.resetAt) buckets.delete(k)
    }
    if (b.count > limit.max) {
      const retry = Math.ceil((b.resetAt - now) / 1000)
      c.header('Retry-After', String(retry))
      throw new ApiError(429, 'RATE_LIMITED', 'Too many requests', `More than ${limit.max} ${kind} requests in a minute. Retry in ${retry}s.`)
    }
    await next()
  }
}

// Origin and CSRF ---------------------------------------------------------------

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** State-changing requests must come from the app's own origin. */
export function originCheck(deps: Deps): MiddlewareHandler<Env> {
  return async (c, next) => {
    if (!UNSAFE.has(c.req.method) || !c.req.path.startsWith('/api/')) return next()
    const origin = c.req.header('origin')
    // localhost and 127.0.0.1 are the same loopback origin to a person, but
    // not to a browser; accept both spellings of the configured origin.
    const loopback = (o: string) => [o, o.replace('//localhost:', '//127.0.0.1:'), o.replace('//127.0.0.1:', '//localhost:')]
    const allowed = new Set([...loopback(deps.config.appOrigin), ...loopback(`http://localhost:${deps.config.port}`)])
    if (!origin || !allowed.has(origin)) {
      throw new ApiError(403, 'ORIGIN_REJECTED', 'Request origin rejected', 'State-changing requests are accepted only from the NEXUS application origin.')
    }
    await next()
  }
}

export function sessionLoader(deps: Deps): MiddlewareHandler<Env> {
  const name = sessionCookieName(deps.config.production)
  return async (c, next) => {
    const token = getCookie(c, name)
    if (token) {
      const resolved = resolveSession(deps.db, token, deps.now().getTime(), deps.config.sessionIdleMs)
      if (resolved) {
        c.set('user', resolved.user)
        c.set('session', resolved.info)
      }
    }
    await next()
  }
}

/** Synchroniser token: X-CSRF-Token must equal the session's token. */
export const csrfCheck: MiddlewareHandler<Env> = async (c, next) => {
  if (!UNSAFE.has(c.req.method) || !c.req.path.startsWith('/api/')) return next()
  // Establishing a session has no session token yet; the origin check covers it.
  if (c.req.path === '/api/session/login' || c.req.path === '/api/session/persona') return next()
  const session = c.get('session')
  if (!session) return next() // requireUser() in the handler refuses it
  const header = c.req.header('x-csrf-token') ?? ''
  if (!safeEqual(header, session.csrfToken)) {
    throw new ApiError(403, 'CSRF_REJECTED', 'Request not verified', 'The request did not carry this session\'s CSRF token. Reload the page and retry.')
  }
  await next()
}

/** Access log: method, path, status, duration, user. Never bodies, cookies or query strings. */
export function accessLog(deps: Deps): MiddlewareHandler<Env> {
  return async (c, next) => {
    const start = performance.now()
    await next()
    if (!c.req.path.startsWith('/api/')) return
    const entry = {
      t: deps.now().toISOString(),
      rid: c.get('requestId'),
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Math.round(performance.now() - start),
      user: c.get('user')?.id ?? null,
    }
    if (process.env.NEXUS_QUIET !== '1') console.log(JSON.stringify(entry))
  }
}
