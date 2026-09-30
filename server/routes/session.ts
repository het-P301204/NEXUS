import { z } from 'zod'
import type { Hono } from 'hono'
import { deleteCookie, setCookie } from 'hono/cookie'
import type { Persona, SessionResponse } from '../../types/api.ts'
import { permissionsFor } from '../../lib/rbac.ts'
import type { Ctx, Deps, Env } from '../context.ts'
import { nowIso, requireUser } from '../context.ts'
import { tx } from '../db.ts'
import { ApiError, notFound } from '../errors.ts'
import { appendAudit } from '../ledger.ts'
import { createSession, destroySession, verifyPassword } from '../auth.ts'
import { getOrg, getUser, listUsers } from '../repo.ts'
import { sessionCookieName } from '../security.ts'
import { id, parseBody } from '../validation.ts'

export function sessionRoutes(app: Hono<Env>, deps: Deps): void {
  const { db, config } = deps
  const cookie = sessionCookieName(config.production)

  function startSession(c: Ctx, userId: string, method: 'password' | 'persona') {
    const now = deps.now().getTime()
    const created = createSession(db, userId, now, config.sessionTtlMs)
    setCookie(c, cookie, created.token, {
      httpOnly: true,
      sameSite: 'Strict',
      secure: config.production,
      path: '/',
      maxAge: Math.floor(config.sessionTtlMs / 1000),
    })
    const user = getUser(db, userId)!
    tx(db, () => {
      appendAudit(db, {
        actorId: user.id,
        actorRole: user.role,
        eventType: 'SESSION_STARTED',
        objectType: 'user',
        objectId: user.id,
        caseId: null,
        source: 'ui',
        summary: `${user.name} signed in (${method === 'persona' ? 'demo persona' : 'password'})`,
        payload: { method },
        at: nowIso(deps),
      })
    })
  }

  app.get('/api/session', (c) => {
    const user = c.get('user')
    const session = c.get('session')
    if (!user || !session) {
      // Not an error: "no session" is an ordinary answer to "who am I?".
      return c.json({ authenticated: false, demoMode: config.demoMode })
    }
    const body: SessionResponse = {
      user,
      org: getOrg(db),
      permissions: permissionsFor(user.role),
      csrfToken: session.csrfToken,
      demoMode: config.demoMode,
      expiresAt: new Date(session.expiresAt).toISOString(),
    }
    return c.json(body)
  })

  app.get('/api/session/personas', (c) => {
    if (!config.demoMode) throw notFound('Resource', 'personas')
    const personas: Persona[] = listUsers(db)
      .filter((u) => u.active)
      .map((u) => ({ id: u.id, name: u.name, role: u.role, title: u.title, initials: u.initials }))
    return c.json({ personas, org: getOrg(db).name })
  })

  app.post('/api/session/persona', async (c) => {
    if (!config.demoMode) throw notFound('Resource', 'persona')
    const { userId } = await parseBody(c, z.object({ userId: id }))
    const user = getUser(db, userId)
    if (!user || !user.active) throw notFound('User', userId)
    const current = c.get('session')
    if (current) destroySession(db, current.idHash)
    startSession(c, user.id, 'persona')
    return c.json({ ok: true })
  })

  app.post('/api/session/login', async (c) => {
    const input = await parseBody(c, z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) }))
    const row = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(input.email.toLowerCase()) as
      | { id: string; password_hash: string | null }
      | undefined
    // One message for unknown account and wrong password; one timing too.
    const ok = verifyPassword(input.password, row?.password_hash ?? null)
    if (!row || !ok) {
      throw new ApiError(401, 'SIGN_IN_FAILED', 'Sign-in failed', 'The email and password do not match an account with password sign-in enabled.')
    }
    // A sign-in always gets a fresh session; whatever session came in is ended.
    const current = c.get('session')
    if (current) destroySession(db, current.idHash)
    startSession(c, row.id, 'password')
    return c.json({ ok: true })
  })

  app.post('/api/session/logout', (c) => {
    requireUser(c)
    const s = c.get('session')
    if (s) destroySession(db, s.idHash)
    deleteCookie(c, cookie, { path: '/', secure: config.production })
    return c.json({ ok: true })
  })
}
