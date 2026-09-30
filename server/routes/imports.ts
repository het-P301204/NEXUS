import { z } from 'zod'
import type { Hono } from 'hono'
import type { Component, Product, ProductComponent, Vulnerability } from '../../types/domain.ts'
import type { ImportPreview } from '../../types/api.ts'
import { csvRecords } from '../../lib/csv.ts'
import type { Deps, Env } from '../context.ts'
import { nowIso, requirePermission } from '../context.ts'
import { nextId, tx } from '../db.ts'
import { ApiError, conflict, invalid } from '../errors.ts'
import { randomToken, sha256Hex } from '../hash.ts'
import { appendAudit } from '../ledger.ts'
import {
  insertComponent,
  insertProduct,
  insertProductComponent,
  insertVulnerability,
  listComponents,
  listProductComponents,
  listProducts,
  listUsers,
  listVulnerabilities,
} from '../repo.ts'
import { line, parseBody, parseValue, requiredLine } from '../validation.ts'
import { componentSchema, productSchema, vulnerabilitySchema, vulnerabilityWarnings } from './portfolio.ts'

/**
 * Structured import: preview, then commit.
 *
 * The preview validates every row and reports valid records, warnings and
 * errors. Commit is all-or-nothing: a preview with any error cannot be
 * committed, and a committed import either writes every record in one
 * transaction or none. Nothing is partially imported, silently or otherwise.
 */

type Kind = 'vulnerabilities' | 'products' | 'components'

interface Pending {
  userId: string
  kind: Kind
  expiresAt: number
  contentHash: string
  records: unknown[]
  errors: number
}

const MAX_ROWS = 500

const mappingSchema = z.object({
  productId: z.string().regex(/^PRD-[A-Z0-9]{2,12}$/),
  version: requiredLine(60),
  relation: z.enum(['direct', 'transitive']),
  usage: line(1000).default(''),
})

function toVulnInput(r: Record<string, unknown>): Record<string, unknown> {
  const num = (v: unknown) => (v === '' || v === undefined || v === null ? null : Number(v))
  const nul = (v: unknown) => (v === '' || v === undefined ? null : v)
  return {
    cve: nul(r.cve),
    title: r.title ?? '',
    cwe: nul(r.cwe),
    cvssScore: num(r.cvss_score ?? r.cvssScore),
    cvssVector: nul(r.cvss_vector ?? r.cvssVector),
    severity: typeof r.severity === 'string' ? r.severity.toUpperCase() : r.severity,
    description: r.description ?? '',
    componentId: nul(r.component_id ?? r.componentId),
    affectedVersions: r.affected_versions ?? r.affectedVersions ?? '',
    fixedVersion: nul(r.fixed_version ?? r.fixedVersion),
    exploitability: r.exploitability ?? '',
    exploitation: typeof (r.exploitation ?? r.active_exploitation) === 'string' ? String(r.exploitation ?? r.active_exploitation).toUpperCase() : 'UNKNOWN',
    source: r.source ?? '',
    discoveredAt: r.discovered_at ?? r.discoveredAt ?? '',
    vendorAdvisory: nul(r.vendor_advisory ?? r.vendorAdvisory),
    threatIntelReference: nul(r.threat_intel_reference ?? r.threatIntelReference),
  }
}

function toProductInput(r: Record<string, unknown>): Record<string, unknown> {
  const bool = (v: unknown) => (typeof v === 'boolean' ? v : typeof v === 'string' ? ['true', 'yes', '1'].includes(v.toLowerCase()) : false)
  return {
    id: r.id,
    name: r.name,
    version: r.version,
    lifecycle: r.lifecycle,
    ownerId: r.owner_id ?? r.ownerId,
    description: r.description ?? '',
    sbomStatus: r.sbom_status ?? r.sbomStatus,
    sbomGeneratedAt: (r.sbom_generated_at ?? r.sbomGeneratedAt) || null,
    environment: r.environment,
    exposure: r.exposure,
    madeAvailableInEu: bool(r.made_available_in_eu ?? r.madeAvailableInEu),
  }
}

export function importRoutes(app: Hono<Env>, deps: Deps): void {
  const { db } = deps
  const pending = new Map<string, Pending>()

  app.post('/api/import/preview', async (c) => {
    const user = requirePermission(c, 'import.commit')
    const input = await parseBody(
      c,
      z.object({ kind: z.enum(['vulnerabilities', 'products', 'components']), format: z.enum(['csv', 'json']), content: z.string().min(1).max(2_000_000) }),
    )
    let rows: Array<Record<string, unknown>>
    try {
      if (input.format === 'csv') rows = csvRecords(input.content)
      else {
        const parsed = JSON.parse(input.content) as unknown
        const list = Array.isArray(parsed) ? parsed : (parsed as Record<string, unknown>)?.[input.kind]
        if (!Array.isArray(list)) throw new Error('not a list')
        rows = list as Array<Record<string, unknown>>
      }
    } catch {
      throw invalid('File could not be read', input.format === 'json' ? `Expected a JSON array, or an object with a "${input.kind}" array.` : 'The CSV could not be parsed.')
    }
    if (rows.length === 0) throw invalid('No records', 'The file contains no records.')
    if (rows.length > MAX_ROWS) throw invalid('Too many records', `Imports are limited to ${MAX_ROWS} records per file; this one has ${rows.length}.`)

    const valid: ImportPreview['valid'] = []
    const warnings: ImportPreview['warnings'] = []
    const errors: ImportPreview['errors'] = []
    const records: unknown[] = []
    const components = listComponents(db)
    const products = listProducts(db)
    const users = listUsers(db)
    const existingCves = new Set(listVulnerabilities(db).map((v) => v.cve).filter(Boolean))
    const seen = new Set<string>()

    rows.forEach((raw, i) => {
      const rowNo = i + 1
      if (typeof raw !== 'object' || raw === null) {
        errors.push({ row: rowNo, message: 'Record is not an object.' })
        return
      }
      try {
        if (input.kind === 'vulnerabilities') {
          const shaped = toVulnInput(raw)
          const comp = raw.component ?? raw.component_purl
          if (!shaped.componentId && typeof comp === 'string' && comp) {
            const match = components.find((x) => x.purl === comp || x.name.toLowerCase() === comp.toLowerCase())
            if (match) shaped.componentId = match.id
            else warnings.push({ row: rowNo, message: `Component "${comp}" is not in the portfolio; the vulnerability is imported without a component mapping.` })
          }
          const v = parseValue(vulnerabilitySchema, shaped)
          if (v.cve && existingCves.has(v.cve)) throw new Error(`${v.cve} is already in the vulnerability register.`)
          if (v.cve && seen.has(v.cve)) throw new Error(`${v.cve} appears more than once in this file.`)
          if (v.cve) seen.add(v.cve)
          if (v.componentId && !components.some((x) => x.id === v.componentId)) throw new Error(`Component ${v.componentId} does not exist.`)
          for (const w of vulnerabilityWarnings(v)) warnings.push({ row: rowNo, message: w })
          records.push(v)
          valid.push({ row: rowNo, summary: `${v.cve ?? '(no CVE)'} -- ${v.title} (${v.severity})` })
        } else if (input.kind === 'products') {
          const p = parseValue(productSchema, toProductInput(raw))
          if (products.some((x) => x.id === p.id)) throw new Error(`${p.id} already exists.`)
          if (seen.has(p.id)) throw new Error(`${p.id} appears more than once in this file.`)
          seen.add(p.id)
          if (!users.some((u) => u.id === p.ownerId)) throw new Error(`Owner ${p.ownerId} is not a known user.`)
          if (p.sbomStatus !== 'current') warnings.push({ row: rowNo, message: `SBOM is ${p.sbomStatus}. Affectedness suggestions for this product will read UNKNOWN.` })
          records.push(p)
          valid.push({ row: rowNo, summary: `${p.id} -- ${p.name} ${p.version}` })
        } else {
          const comp = parseValue(componentSchema, { name: raw.name, purl: raw.purl, ecosystem: raw.ecosystem, supplier: raw.supplier })
          const map = parseValue(mappingSchema, { productId: raw.product_id ?? raw.productId, version: raw.version, relation: raw.relation ?? 'direct', usage: raw.usage ?? '' })
          if (!products.some((p) => p.id === map.productId)) throw new Error(`Product ${map.productId} does not exist.`)
          const key = `${map.productId}|${comp.purl}`
          if (seen.has(key)) throw new Error(`${comp.name} is listed twice for ${map.productId}.`)
          seen.add(key)
          const existing = components.find((x) => x.purl === comp.purl)
          if (existing && listProductComponents(db).some((pc) => pc.productId === map.productId && pc.componentId === existing.id)) {
            throw new Error(`${comp.name} is already mapped into ${map.productId}.`)
          }
          if (!existing) warnings.push({ row: rowNo, message: `${comp.name} is a new component and will be added to the component register.` })
          records.push({ comp, map })
          valid.push({ row: rowNo, summary: `${comp.name} ${map.version} -> ${map.productId} (${map.relation})` })
        }
      } catch (err) {
        const message = err instanceof ApiError ? err.reason : err instanceof Error ? err.message : 'Invalid record.'
        errors.push({ row: rowNo, message })
      }
    })

    const token = randomToken(18)
    const now = deps.now().getTime()
    for (const [k, v] of pending) if (v.expiresAt < now) pending.delete(k)
    pending.set(token, { userId: user.id, kind: input.kind, expiresAt: now + 10 * 60_000, contentHash: sha256Hex(input.content), records, errors: errors.length })
    const body: ImportPreview = { token, kind: input.kind, format: input.format, valid, warnings, errors, canCommit: errors.length === 0 }
    return c.json(body)
  })

  app.post('/api/import/commit', async (c) => {
    const user = requirePermission(c, 'import.commit')
    const { token } = await parseBody(c, z.object({ token: z.string().min(10).max(64) }))
    const p = pending.get(token)
    if (!p || p.userId !== user.id || p.expiresAt < deps.now().getTime()) {
      throw conflict('IMPORT_PREVIEW_EXPIRED', 'Preview expired', 'Import previews are valid for 10 minutes and only for the user who created them. Run the preview again.')
    }
    if (p.errors > 0) {
      throw conflict('IMPORT_HAS_ERRORS', 'Import blocked', `The preview found ${p.errors} error(s). Nothing is imported until every record is valid.`)
    }
    const now = nowIso(deps)
    const ids: string[] = []
    // The preview's duplicate checks ran against the register as it was then.
    // They run again here, inside the transaction, so a second preview of the
    // same file (or anyone's commit in between) cannot import a record twice.
    const stale = (row: number, what: string) => {
      pending.delete(token)
      return conflict('IMPORT_PREVIEW_STALE', 'Preview out of date', `Record ${row}: ${what} since this preview was made. Nothing was imported. Run the preview again.`)
    }
    tx(db, () => {
      const cves = new Set(listVulnerabilities(db).map((v) => v.cve).filter(Boolean))
      const productIds = new Set(listProducts(db).map((x) => x.id))
      p.records.forEach((r, i) => {
        if (p.kind === 'vulnerabilities') {
          const cve = (r as Vulnerability).cve
          if (cve && cves.has(cve)) throw stale(i + 1, `${cve} has been added to the vulnerability register`)
        } else if (p.kind === 'products') {
          if (productIds.has((r as Product).id)) throw stale(i + 1, `${(r as Product).id} has been added`)
        } else {
          const { comp, map } = r as { comp: Omit<Component, 'id'>; map: z.output<typeof mappingSchema> }
          const existing = listComponents(db).find((x) => x.purl === comp.purl)
          if (existing && listProductComponents(db).some((pc) => pc.productId === map.productId && pc.componentId === existing.id)) {
            throw stale(i + 1, `${comp.name} has been mapped into ${map.productId}`)
          }
        }
      })
      for (const r of p.records) {
        if (p.kind === 'vulnerabilities') {
          const v: Vulnerability = { id: nextId(db, 'VUL'), ...(r as Omit<Vulnerability, 'id' | 'createdAt' | 'createdBy'>), createdAt: now, createdBy: user.id }
          insertVulnerability(db, v)
          ids.push(v.id)
        } else if (p.kind === 'products') {
          insertProduct(db, r as Product)
          ids.push((r as Product).id)
        } else {
          const { comp, map } = r as { comp: Omit<Component, 'id'>; map: z.output<typeof mappingSchema> }
          let component = listComponents(db).find((x) => x.purl === comp.purl)
          if (!component) {
            component = { id: nextId(db, 'CMP'), ...comp }
            insertComponent(db, component)
          }
          const pc: ProductComponent = { id: nextId(db, 'PC'), productId: map.productId, componentId: component.id, version: map.version, relation: map.relation, viaId: null, usage: map.usage }
          insertProductComponent(db, pc)
          ids.push(pc.id)
        }
      }
      appendAudit(db, {
        actorId: user.id,
        actorRole: user.role,
        eventType: 'IMPORT_COMMITTED',
        objectType: p.kind,
        objectId: `import:${p.contentHash.slice(0, 12)}`,
        caseId: null,
        source: 'import',
        summary: `${ids.length} ${p.kind} imported`,
        payload: { kind: p.kind, count: ids.length, ids, contentSha256: p.contentHash },
        at: now,
      })
    })
    pending.delete(token)
    return c.json({ imported: ids.length, ids })
  })
}
