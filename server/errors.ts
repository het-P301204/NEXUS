/**
 * Structured errors. Every refusal says what was blocked, why, and where the
 * user fixes it -- never "something went wrong". Internal detail (stack
 * traces, SQL) is logged on the server and never sent to the client.
 */

export interface ErrorAction {
  label: string
  href: string
}

export interface ErrorBody {
  code: string
  title: string
  reason: string
  action?: ErrorAction
  fields?: Record<string, string>
  requestId?: string
}

export class ApiError extends Error {
  status: number
  code: string
  title: string
  reason: string
  action: ErrorAction | undefined
  fields: Record<string, string> | undefined

  constructor(
    status: number,
    code: string,
    title: string,
    reason: string,
    extra: { action?: ErrorAction; fields?: Record<string, string> } = {},
  ) {
    super(`${code}: ${reason}`)
    this.status = status
    this.code = code
    this.title = title
    this.reason = reason
    this.action = extra.action
    this.fields = extra.fields
  }

  body(requestId?: string): ErrorBody {
    return {
      code: this.code,
      title: this.title,
      reason: this.reason,
      ...(this.action ? { action: this.action } : {}),
      ...(this.fields ? { fields: this.fields } : {}),
      ...(requestId ? { requestId } : {}),
    }
  }
}

export const notFound = (what: string, id: string) =>
  new ApiError(404, 'NOT_FOUND', `${what} not found`, `No ${what.toLowerCase()} with id ${id} exists, or you cannot see it.`)

export const forbidden = (reason: string) =>
  new ApiError(403, 'PERMISSION_DENIED', 'Permission required', reason)

export const conflict = (code: string, title: string, reason: string, action?: ErrorAction) =>
  new ApiError(409, code, title, reason, action ? { action } : {})

export const invalid = (title: string, reason: string, fields?: Record<string, string>) =>
  new ApiError(422, 'VALIDATION_FAILED', title, reason, fields ? { fields } : {})
