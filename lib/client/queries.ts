import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AuditEvent, Permission, ReportVersion, RuleSet, User, Vulnerability } from '../../types/domain.ts'
import type {
  AnalyticsResponse,
  CaseDetailResponse,
  CaseListItem,
  ComponentListItem,
  EvidenceDetailResponse,
  EvidenceListItem,
  GraphResponse,
  ImportPreview,
  LedgerResponse,
  NotificationsResponse,
  OverviewResponse,
  Persona,
  ProductListItem,
  ReportDetailResponse,
  SearchResult,
  SettingsResponse,
  SystemStatus,
  VulnerabilityDetail,
} from '../../types/api.ts'
import type { ScenarioDef } from '../../data/scenarios.ts'
import { api } from './api.ts'
import { syncServerTime } from './useNow.ts'

/**
 * Server state. Every query key starts with a resource name so a mutation
 * can invalidate everything it could have changed -- case data feeds the
 * overview, the clocks page, analytics and the ledger, so most writes
 * invalidate broadly rather than guess.
 */

export const keys = {
  overview: ['overview'] as const,
  cases: ['cases'] as const,
  case: (id: string) => ['case', id] as const,
  users: ['users'] as const,
  products: ['products'] as const,
  product: (id: string) => ['product', id] as const,
  components: ['components'] as const,
  graph: ['graph'] as const,
  vulnerabilities: ['vulnerabilities'] as const,
  vulnerability: (id: string) => ['vulnerability', id] as const,
  evidence: ['evidence'] as const,
  evidenceItem: (id: string) => ['evidence-item', id] as const,
  reports: ['reports'] as const,
  report: (id: string) => ['report', id] as const,
  ledger: (caseId?: string) => ['ledger', caseId ?? 'all'] as const,
  rules: ['rules'] as const,
  analytics: (range: string) => ['analytics', range] as const,
  notifications: ['notifications'] as const,
  settings: ['settings'] as const,
  status: ['status'] as const,
  scenarios: ['scenarios'] as const,
  search: (q: string) => ['search', q] as const,
}

export function useOverview() {
  return useQuery({
    queryKey: keys.overview,
    queryFn: async () => {
      const r = await api<OverviewResponse>('/api/overview')
      syncServerTime(r.now)
      return r
    },
    refetchInterval: 60_000,
  })
}

export function useCases() {
  return useQuery({
    queryKey: keys.cases,
    queryFn: async () => {
      const r = await api<{ items: CaseListItem[]; now: string }>('/api/cases')
      syncServerTime(r.now)
      return r.items
    },
    refetchInterval: 60_000,
  })
}

export function useCase(id: string) {
  return useQuery({
    queryKey: keys.case(id),
    enabled: id.length > 0,
    queryFn: async () => {
      const r = await api<CaseDetailResponse>(`/api/cases/${encodeURIComponent(id)}`)
      syncServerTime(r.analysis.now)
      return r
    },
    refetchInterval: 60_000,
  })
}

export function useUsers() {
  return useQuery({ queryKey: keys.users, queryFn: async () => (await api<{ users: User[] }>('/api/users')).users, staleTime: 300_000 })
}

export function useProducts() {
  return useQuery({ queryKey: keys.products, queryFn: async () => (await api<{ items: ProductListItem[] }>('/api/products')).items })
}

export function useComponents() {
  return useQuery({ queryKey: keys.components, queryFn: async () => (await api<{ items: ComponentListItem[] }>('/api/components')).items })
}

export function useGraph() {
  return useQuery({ queryKey: keys.graph, queryFn: () => api<GraphResponse>('/api/graph') })
}

export type VulnerabilityListItem = Vulnerability & {
  componentName: string | null
  cases: Array<{ id: string; title: string; status: string }>
  intelCount: number
}

export function useVulnerabilities() {
  return useQuery({ queryKey: keys.vulnerabilities, queryFn: async () => (await api<{ items: VulnerabilityListItem[] }>('/api/vulnerabilities')).items })
}

export function useVulnerability(id: string) {
  return useQuery({ queryKey: keys.vulnerability(id), queryFn: async () => (await api<{ item: VulnerabilityDetail }>(`/api/vulnerabilities/${encodeURIComponent(id)}`)).item })
}

export function useEvidence() {
  return useQuery({ queryKey: keys.evidence, queryFn: async () => (await api<{ items: EvidenceListItem[] }>('/api/evidence')).items })
}

export function useEvidenceItem(id: string) {
  return useQuery({ queryKey: keys.evidenceItem(id), queryFn: () => api<EvidenceDetailResponse>(`/api/evidence/${encodeURIComponent(id)}`) })
}

export type ReportListItem = Omit<ReportVersion, 'content'>

export function useReports() {
  return useQuery({ queryKey: keys.reports, queryFn: async () => (await api<{ reports: ReportListItem[] }>('/api/reports')).reports })
}

export function useReport(id: string) {
  return useQuery({ queryKey: keys.report(id), queryFn: () => api<ReportDetailResponse>(`/api/reports/${encodeURIComponent(id)}`) })
}

export function useLedger(caseId?: string) {
  return useQuery({
    queryKey: keys.ledger(caseId),
    queryFn: () => api<LedgerResponse>(`/api/ledger${caseId ? `?caseId=${encodeURIComponent(caseId)}` : ''}`),
  })
}

export interface SelfTest {
  rules: { ok: boolean; passed: number; total: number; detail: string; vectors: Array<{ name: string; pass: boolean }> }
  deadlines: { ok: boolean; passed: number; total: number; detail: string; vectors: Array<{ name: string; pass: boolean }> }
}

export function useRules() {
  return useQuery({ queryKey: keys.rules, queryFn: () => api<{ ruleSet: RuleSet; selfTest: SelfTest }>('/api/rules'), staleTime: 300_000 })
}

export function useAnalytics(range: string) {
  return useQuery({ queryKey: keys.analytics(range), queryFn: () => api<AnalyticsResponse>(`/api/analytics?range=${range}`) })
}

export function useNotifications() {
  return useQuery({ queryKey: keys.notifications, queryFn: () => api<NotificationsResponse>('/api/notifications'), refetchInterval: 60_000 })
}

export function useSettings() {
  return useQuery({ queryKey: keys.settings, queryFn: () => api<SettingsResponse>('/api/settings') })
}

export function useSystemStatus() {
  return useQuery({ queryKey: keys.status, queryFn: () => api<SystemStatus>('/api/system/status'), refetchInterval: 120_000 })
}

export function useScenarios(enabled: boolean) {
  return useQuery({ queryKey: keys.scenarios, queryFn: async () => (await api<{ scenarios: ScenarioDef[] }>('/api/demo/scenarios')).scenarios, enabled })
}

export function usePersonas() {
  return useQuery({ queryKey: ['personas'], queryFn: () => api<{ personas: Persona[]; org: string }>('/api/session/personas'), retry: false })
}

export function useSearch(q: string) {
  return useQuery({
    queryKey: keys.search(q),
    queryFn: async () => (await api<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(q)}`)).results,
    enabled: q.trim().length >= 2,
    staleTime: 10_000,
  })
}

/**
 * A mutation that invalidates every derived view when it succeeds. Writes
 * are rare and reads are cheap; a stale deadline is not.
 */
export function useAction<TInput, TOutput = unknown>(fn: (input: TInput) => Promise<TOutput>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await qc.invalidateQueries()
    },
  })
}

export type { AuditEvent, ImportPreview, Permission }
