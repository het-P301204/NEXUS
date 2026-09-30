import {
  BarChart3,
  BookOpen,
  Boxes,
  Bug,
  Fingerprint,
  FileText,
  FolderKanban,
  LayoutDashboard,
  Scale,
  ScrollText,
  Settings,
  Timer,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  group: 'operate' | 'record' | 'govern'
}

/**
 * Navigation follows the product's chain of reasoning rather than a feature
 * list: operate on cases and clocks, keep the record, govern the rules.
 */
export const NAV: NavItem[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, group: 'operate' },
  { to: '/cases', label: 'Cases', icon: FolderKanban, group: 'operate' },
  { to: '/vulnerabilities', label: 'Vulnerabilities', icon: Bug, group: 'operate' },
  { to: '/products', label: 'Products', icon: Boxes, group: 'operate' },
  { to: '/determinations', label: 'Determinations', icon: Scale, group: 'record' },
  { to: '/clocks', label: 'Clocks', icon: Timer, group: 'record' },
  { to: '/evidence', label: 'Evidence', icon: Fingerprint, group: 'record' },
  { to: '/reports', label: 'Reports', icon: FileText, group: 'record' },
  { to: '/ledger', label: 'Audit Ledger', icon: ScrollText, group: 'record' },
  { to: '/rules', label: 'Rules', icon: BookOpen, group: 'govern' },
  { to: '/analytics', label: 'Analytics', icon: BarChart3, group: 'govern' },
  { to: '/settings', label: 'Settings', icon: Settings, group: 'govern' },
]

export const GROUP_LABELS: Record<NavItem['group'], string> = {
  operate: 'Operate',
  record: 'Record',
  govern: 'Govern',
}
