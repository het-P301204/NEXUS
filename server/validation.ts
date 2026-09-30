import { z } from 'zod'
import { cleanLine, cleanText } from '../lib/text.ts'
import { isInstant } from '../lib/engine/time.ts'
import type { Ctx } from './context.ts'
import { invalid } from './errors.ts'

/**
 * Input validation. Every request body passes through one of these schemas
 * before a handler reads it. Text fields are cleaned at this boundary --
 * invisible and bidirectional control characters stripped -- so no later
 * layer (UI, report, export) receives them.
 */

export const line = (max = 200) =>
  z
    .string()
    .max(max * 2)
    .transform(cleanLine)
    .pipe(z.string().max(max))

export const requiredLine = (max = 200) => line(max).pipe(z.string().min(1, 'Required'))

export const text = (max = 8000) =>
  z
    .string()
    .max(max * 2)
    .transform(cleanText)
    .pipe(z.string().max(max))

export const instant = z
  .string()
  .max(40)
  .refine(isInstant, 'Must be an ISO-8601 instant with an explicit offset, e.g. 2026-09-30T08:31:22Z')
  .transform((v) => new Date(v).toISOString())

export const timezone = z
  .string()
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz })
      return true
    } catch {
      return false
    }
  }, 'Must be an IANA timezone, e.g. Europe/Berlin')

export const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/, 'Invalid identifier')
export const idList = z.array(id).max(50)

export const cve = z
  .string()
  .regex(/^CVE-\d{4}-\d{4,7}$/, 'CVE identifiers look like CVE-2026-12345')
export const cwe = z.string().regex(/^CWE-\d{1,5}$/, 'CWE identifiers look like CWE-787')

export const severity = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'])
export const exploitation = z.enum(['CONFIRMED', 'SUSPECTED', 'NOT_OBSERVED', 'UNKNOWN'])
export const confidence = z.enum(['HIGH', 'MEDIUM', 'LOW'])
export const answer = z.enum(['YES', 'NO', 'UNKNOWN'])
export const role = z.enum([
  'administrator',
  'psirt_lead',
  'psirt_analyst',
  'security_engineer',
  'security_manager',
  'compliance_reviewer',
  'legal_reviewer',
  'executive_approver',
  'read_only',
])

export const evidenceType = z.enum([
  'SBOM',
  'VEX',
  'SCANNER_RESULT',
  'EXPLOIT_EVIDENCE',
  'INCIDENT_RECORD',
  'EMAIL',
  'TICKET',
  'LOG',
  'SCREENSHOT',
  'VENDOR_ADVISORY',
  'ANALYST_NOTE',
  'POLICY',
  'CONFIGURATION',
  'THREAT_INTELLIGENCE',
  'CUSTOMER_COMMUNICATION',
])

export const sourceKind = z.enum(['system_of_record', 'external_document', 'analyst_attestation'])

export async function parseBody<T extends z.ZodType>(c: Ctx, schema: T): Promise<z.output<T>> {
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    throw invalid('Request body is not JSON', 'The request body could not be parsed as JSON.')
  }
  return parseValue(schema, raw)
}

export function parseValue<T extends z.ZodType>(schema: T, raw: unknown): z.output<T> {
  const result = schema.safeParse(raw)
  if (!result.success) {
    const fields: Record<string, string> = {}
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_'
      if (!fields[key]) fields[key] = issue.message
    }
    const first = Object.entries(fields)[0]
    throw invalid('Input rejected', first ? `${first[0]}: ${first[1]}` : 'The request did not match the expected shape.', fields)
  }
  return result.data
}
