import type { Permission, RoleId } from '../types/domain.ts'

/**
 * Role-based access control.
 *
 * The one permission matrix. The server enforces it on every request; the
 * browser reads the same table only to decide which controls to show. Hiding
 * a button is a courtesy, not a control. Every action is authorised again on
 * the server, together with the object-level checks in server/authz.ts.
 */

export const ROLES: Record<RoleId, { label: string; description: string }> = {
  administrator: {
    label: 'Administrator',
    description: 'Platform configuration, users and settings. Does not record determinations or approve reports.',
  },
  psirt_lead: {
    label: 'PSIRT Lead',
    description: 'Runs the response. Establishes awareness, records decisions, submits reports.',
  },
  psirt_analyst: {
    label: 'PSIRT Analyst',
    description: 'Investigates cases they own or collaborate on. Records determinations and draft decisions.',
  },
  security_engineer: {
    label: 'Security Engineer',
    description: 'Validates affectedness against the product. Records determinations and technical evidence.',
  },
  security_manager: {
    label: 'Security Manager',
    description: 'Designated security authority. Establishes awareness, approves reports, controls reopening.',
  },
  compliance_reviewer: {
    label: 'Compliance Reviewer',
    description: 'Reviews and approves decision records and notifications.',
  },
  legal_reviewer: {
    label: 'Legal Reviewer',
    description: 'Reviews decisions not to report. Reads restricted evidence.',
  },
  executive_approver: {
    label: 'Executive Approver',
    description: 'Final approval and submission authority for notifications.',
  },
  read_only: {
    label: 'Read Only',
    description: 'Reads cases and the ledger; can verify ledger integrity. Cannot change anything.',
  },
}

export const ROLE_ORDER: RoleId[] = [
  'administrator',
  'psirt_lead',
  'psirt_analyst',
  'security_engineer',
  'security_manager',
  'compliance_reviewer',
  'legal_reviewer',
  'executive_approver',
  'read_only',
]

const ALL: RoleId[] = ROLE_ORDER

const MATRIX: Record<Permission, RoleId[]> = {
  'case.create': ['administrator', 'psirt_lead', 'psirt_analyst', 'security_manager'],
  'case.edit': ['administrator', 'psirt_lead', 'psirt_analyst', 'security_manager'],
  'case.assign': ['administrator', 'psirt_lead', 'security_manager'],
  'case.close': ['psirt_lead', 'security_manager'],
  'case.reopen': ['security_manager'],
  'case.archive': ['administrator', 'security_manager'],
  'vulnerability.write': ['administrator', 'psirt_lead', 'psirt_analyst', 'security_engineer'],
  'product.write': ['administrator', 'psirt_lead', 'security_engineer'],
  'determination.record': ['psirt_lead', 'psirt_analyst', 'security_engineer'],
  'awareness.establish': ['psirt_lead', 'security_manager'],
  'clock.record': ['psirt_lead', 'psirt_analyst', 'security_engineer', 'security_manager'],
  'clock.correct': ['psirt_lead', 'security_manager'],
  'decision.record': ['psirt_lead', 'psirt_analyst', 'security_manager'],
  'review.approve': ['psirt_lead', 'security_manager', 'compliance_reviewer', 'legal_reviewer', 'executive_approver'],
  'report.generate': ['psirt_lead', 'psirt_analyst', 'security_manager', 'compliance_reviewer'],
  'submission.advance': ['psirt_lead', 'psirt_analyst', 'security_manager', 'compliance_reviewer'],
  'submission.submit': ['psirt_lead', 'security_manager', 'executive_approver'],
  'evidence.read': ALL,
  'evidence.read_restricted': ['psirt_lead', 'security_manager', 'compliance_reviewer', 'legal_reviewer'],
  'evidence.write': [
    'psirt_lead',
    'psirt_analyst',
    'security_engineer',
    'security_manager',
    'compliance_reviewer',
    'legal_reviewer',
  ],
  'ledger.verify': ALL,
  'comment.write': ALL.filter((r) => r !== 'read_only'),
  'import.commit': ['administrator', 'psirt_lead', 'security_engineer'],
  'settings.manage': ['administrator'],
  'demo.control': ['administrator', 'psirt_lead', 'security_manager'],
}

export const PERMISSION_LABELS: Record<Permission, string> = {
  'case.create': 'Create cases',
  'case.edit': 'Edit case details',
  'case.assign': 'Assign and transfer ownership',
  'case.close': 'Close cases',
  'case.reopen': 'Reopen closed cases',
  'case.archive': 'Archive cases',
  'vulnerability.write': 'Add and import vulnerabilities',
  'product.write': 'Manage products and components',
  'determination.record': 'Record affectedness determinations',
  'awareness.establish': 'Establish awareness',
  'clock.record': 'Record clock events',
  'clock.correct': 'Record timestamp corrections',
  'decision.record': 'Record reportability decisions',
  'review.approve': 'Approve, reject, request changes',
  'report.generate': 'Generate report versions',
  'submission.advance': 'Advance submission workflow',
  'submission.submit': 'Submit (simulated)',
  'evidence.read': 'Read evidence',
  'evidence.read_restricted': 'Read restricted evidence',
  'evidence.write': 'Add and link evidence',
  'ledger.verify': 'Verify ledger integrity',
  'comment.write': 'Comment',
  'import.commit': 'Commit imports',
  'settings.manage': 'Manage settings',
  'demo.control': 'Control demo mode',
}

export const PERMISSIONS = Object.keys(MATRIX) as Permission[]

export function can(role: RoleId, permission: Permission): boolean {
  return MATRIX[permission].includes(role)
}

export function permissionsFor(role: RoleId): Permission[] {
  return PERMISSIONS.filter((p) => can(role, p))
}

/**
 * Roles that act on any case. Everyone else acts only on cases they own or
 * collaborate on -- the object-level check that stops an analyst editing a
 * case by guessing its id.
 */
export const CASE_WIDE_ROLES: RoleId[] = ['psirt_lead', 'security_manager', 'administrator']

/**
 * Approval policy per report kind: which roles must approve, in addition to
 * the rule that nobody approves a report they generated or a decision they
 * recorded.
 */
export const APPROVAL_POLICY: Record<string, { anyOf: RoleId[][]; label: string }> = {
  EARLY_WARNING: {
    anyOf: [['psirt_lead'], ['security_manager'], ['executive_approver']],
    label: 'One approval from PSIRT Lead, Security Manager or Executive Approver.',
  },
  VULNERABILITY_NOTIFICATION: {
    anyOf: [['security_manager', 'compliance_reviewer']],
    label: 'Security Manager and Compliance Reviewer.',
  },
  FINAL_REPORT: {
    anyOf: [['security_manager', 'compliance_reviewer']],
    label: 'Security Manager and Compliance Reviewer.',
  },
  DECISION_RECORD: {
    anyOf: [['compliance_reviewer'], ['legal_reviewer']],
    label: 'Compliance Reviewer or Legal Reviewer. A decision not to report is reviewed like a report.',
  },
}
