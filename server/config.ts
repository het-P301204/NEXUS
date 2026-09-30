import path from 'node:path'

/**
 * Server configuration, from the environment only. Nothing here is ever sent
 * to the browser; the client learns only `demoMode` through /api/session.
 */

try {
  process.loadEnvFile('.env')
} catch {
  // No .env file: defaults apply.
}

function int(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer`)
  return n
}

export interface Config {
  production: boolean
  port: number
  appOrigin: string
  demoMode: boolean
  storageDir: string
  dbPath: string
  evidenceDir: string
  maxUploadBytes: number
  sessionTtlMs: number
  sessionIdleMs: number
  /** Multiplies every rate limit. Tests raise it; production leaves it at 1. */
  rateLimitScale: number
}

export function loadConfig(argv: string[] = process.argv): Config {
  const production = argv.includes('--production') || process.env.NODE_ENV === 'production'
  const port = int('PORT', 8787)
  const storageDir = path.resolve(process.env.STORAGE_DIR ?? './storage')
  return {
    production,
    port,
    appOrigin: process.env.APP_ORIGIN ?? (production ? `http://localhost:${port}` : 'http://localhost:5173'),
    demoMode: (process.env.DEMO_MODE ?? 'true').toLowerCase() === 'true',
    storageDir,
    dbPath: process.env.DB_PATH ?? path.join(storageDir, 'nexus.sqlite'),
    evidenceDir: path.join(storageDir, 'evidence'),
    maxUploadBytes: int('MAX_UPLOAD_BYTES', 10 * 1024 * 1024),
    sessionTtlMs: int('SESSION_TTL_MINUTES', 480) * 60_000,
    sessionIdleMs: int('SESSION_IDLE_MINUTES', 60) * 60_000,
    rateLimitScale: int('RATE_LIMIT_SCALE', 1),
  }
}
