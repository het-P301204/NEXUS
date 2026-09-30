import type { Context } from 'hono'
import type { Permission, User } from '../types/domain.ts'
import { can } from '../lib/rbac.ts'
import type { Config } from './config.ts'
import type { Db } from './db.ts'
import { ApiError, forbidden } from './errors.ts'

export interface SessionInfo {
  idHash: string
  csrfToken: string
  expiresAt: number
}

export interface Env {
  Variables: {
    requestId: string
    user: User | null
    session: SessionInfo | null
  }
}

export interface Deps {
  db: Db
  config: Config
  /** Injected so tests can fix time. Never Date.now() in a handler. */
  now: () => Date
}

export type Ctx = Context<Env>

export function nowIso(deps: Deps): string {
  return deps.now().toISOString()
}

export function requireUser(c: Ctx): User {
  const user = c.get('user')
  if (!user) {
    throw new ApiError(401, 'SESSION_REQUIRED', 'Sign-in required', 'Your session has ended or was never started. Sign in to continue.', {
      action: { label: 'Sign in', href: '/signin' },
    })
  }
  return user
}

export function requirePermission(c: Ctx, permission: Permission): User {
  const user = requireUser(c)
  if (!can(user.role, permission)) {
    throw forbidden(`Your role does not include "${permission}". The request was refused on the server.`)
  }
  return user
}
