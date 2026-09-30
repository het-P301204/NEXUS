import crypto from 'node:crypto'
import type { User } from '../types/domain.ts'
import type { Db } from './db.ts'
import { randomToken, sha256Hex } from './hash.ts'
import type { SessionInfo } from './context.ts'

/**
 * Sessions and credentials.
 *
 * - The session id is 32 random bytes, sent only as an HttpOnly,
 *   SameSite=Strict cookie. The database stores its SHA-256, so a copy of the
 *   database does not hold usable session tokens.
 * - Each session carries its own CSRF token, returned by /api/session and
 *   required as X-CSRF-Token on every state-changing request.
 * - Sessions expire absolutely (SESSION_TTL_MINUTES) and on idle
 *   (SESSION_IDLE_MINUTES).
 * - Passwords are hashed with scrypt and compared in constant time. Demo
 *   users have no password unless DEMO_PASSWORD is set at seed time; there is
 *   no default credential anywhere in the code.
 */

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 }

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16)
  const key = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p })
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`
}

export function verifyPassword(password: string, stored: string | null): boolean {
  // Run a hash even when there is no stored credential, so a missing account
  // and a wrong password take the same time.
  const parts = (stored ?? 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=').split('$')
  const [scheme, n, r, p, saltB64, keyB64] = parts
  if (scheme !== 'scrypt' || !saltB64 || !keyB64) return false
  const expected = Buffer.from(keyB64, 'base64')
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  })
  return stored !== null && crypto.timingSafeEqual(actual, expected)
}

export interface CreatedSession {
  token: string
  info: SessionInfo
}

export function createSession(db: Db, userId: string, nowMs: number, ttlMs: number): CreatedSession {
  const token = randomToken(32)
  const idHash = sha256Hex(token)
  const csrfToken = randomToken(24)
  const expiresAt = nowMs + ttlMs
  db.prepare(
    'INSERT INTO sessions(id_hash, user_id, csrf_token, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(idHash, userId, csrfToken, nowMs, nowMs, expiresAt)
  return { token, info: { idHash, csrfToken, expiresAt } }
}

export function resolveSession(
  db: Db,
  token: string,
  nowMs: number,
  idleMs: number,
): { user: User; info: SessionInfo } | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null
  const idHash = sha256Hex(token)
  const row = db
    .prepare(
      'SELECT s.user_id, s.csrf_token, s.last_seen_at, s.expires_at, u.data FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?',
    )
    .get(idHash) as { user_id: string; csrf_token: string; last_seen_at: number; expires_at: number; data: string } | undefined
  if (!row) return null
  if (nowMs >= row.expires_at || nowMs - row.last_seen_at > idleMs) {
    db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(idHash)
    return null
  }
  const user = JSON.parse(row.data) as User
  if (!user.active) return null
  // Touch at most once a minute to keep writes off the read path.
  if (nowMs - row.last_seen_at > 60_000) {
    db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?').run(nowMs, idHash)
  }
  return { user, info: { idHash, csrfToken: row.csrf_token, expiresAt: row.expires_at } }
}

export function destroySession(db: Db, idHash: string): void {
  db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(idHash)
}

export function destroyUserSessions(db: Db, userId: string): void {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}
