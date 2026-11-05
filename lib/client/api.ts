import type { ErrorBody } from '../../server/errors.ts'
import { STATIC_DEMO } from './mode.ts'
import { demoFetch } from './static-demo.ts'

/**
 * The browser's only door to the server. Adds the session's CSRF token to
 * every state-changing request, and turns every failure into an ApiFailure
 * carrying the server's structured error -- what was blocked, why, and where
 * to fix it.
 */

let csrfToken: string | null = null

/**
 * Every request to /api goes through here. In the static demo build there is
 * no server, and the recorded snapshot answers instead (static-demo.ts).
 */
export function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  return STATIC_DEMO ? demoFetch(input, init) : fetch(input, init)
}

export function setCsrfToken(token: string | null): void {
  csrfToken = token
}

export class ApiFailure extends Error {
  status: number
  body: ErrorBody

  constructor(status: number, body: ErrorBody) {
    super(body.reason)
    this.status = status
    this.body = body
  }
}

const listeners = new Set<() => void>()
export function onSessionExpired(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  form?: FormData
  signal?: AbortSignal
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET')
  const headers: Record<string, string> = { accept: 'application/json' }
  if (method !== 'GET' && csrfToken) headers['x-csrf-token'] = csrfToken
  let body: BodyInit | undefined
  if (opts.form) body = opts.form
  else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }
  let res: Response
  try {
    res = await apiFetch(path, { method, headers, body, credentials: 'same-origin', signal: opts.signal })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new ApiFailure(0, {
      code: 'SERVER_UNREACHABLE',
      title: 'Server unreachable',
      reason: 'The NEXUS API did not respond. Check that the server is running, then retry.',
    })
  }
  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }
  if (!res.ok) {
    const err = (data as { error?: ErrorBody } | null)?.error ?? {
      code: `HTTP_${res.status}`,
      title: 'Request refused',
      reason: `The server answered ${res.status} without a structured explanation.`,
    }
    if (res.status === 401 && path !== '/api/session') for (const fn of listeners) fn()
    throw new ApiFailure(res.status, err)
  }
  return data as T
}

/** Trigger a download from an authorised GET endpoint without exposing a public URL. */
export async function download(path: string, fallbackName: string): Promise<void> {
  const res = await apiFetch(path, { credentials: 'same-origin' })
  if (!res.ok) {
    let body: ErrorBody = { code: `HTTP_${res.status}`, title: 'Download refused', reason: `The server answered ${res.status}.` }
    try {
      body = ((await res.json()) as { error: ErrorBody }).error
    } catch {
      /* keep default */
    }
    throw new ApiFailure(res.status, body)
  }
  const blob = await res.blob()
  const disposition = res.headers.get('content-disposition') ?? ''
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
