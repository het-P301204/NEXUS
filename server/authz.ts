import type { Case, Evidence, User } from '../types/domain.ts'
import { CASE_WIDE_ROLES, can } from '../lib/rbac.ts'
import type { Db } from './db.ts'
import { forbidden, notFound } from './errors.ts'
import { getCase } from './repo.ts'

/**
 * Object-level authorisation, on top of the role matrix.
 *
 * A role says what kind of action a user may take. These checks say on
 * which objects: an analyst may record a determination, but only on a case
 * they own or collaborate on. Without this check, any analyst could act on
 * any case by knowing -- or guessing -- its id.
 */

export function canWriteCase(user: User, c: Case): boolean {
  if (CASE_WIDE_ROLES.includes(user.role)) return true
  return c.ownerId === user.id || c.collaboratorIds.includes(user.id)
}

export function loadCaseForRead(db: Db, id: string): Case {
  const c = getCase(db, id)
  if (!c) throw notFound('Case', id)
  return c
}

export function loadCaseForWrite(db: Db, user: User, id: string): Case {
  const c = loadCaseForRead(db, id)
  if (!canWriteCase(user, c)) {
    throw forbidden(`You are not the owner or a collaborator on ${c.id}. Ask the case owner or a PSIRT Lead to add you.`)
  }
  return assertCaseOpen(c)
}

/**
 * A closed or archived case accepts no writes at all, including reviews and
 * comments from people who are not its owner or collaborators.
 */
export function assertCaseOpen(c: Case): Case {
  if (c.lifecycle !== 'open') {
    throw forbidden(`${c.id} is ${c.lifecycle}. Reopening requires the Security Manager role.`)
  }
  return c
}

export function canReadEvidence(user: User, e: Evidence): boolean {
  if (!can(user.role, 'evidence.read')) return false
  return e.classification !== 'restricted' || can(user.role, 'evidence.read_restricted')
}

/**
 * Restricted evidence stays on the register for users who cannot read it --
 * its id, type and hash are visible, so the record is complete -- but its
 * title, description and source are withheld.
 */
export function redactEvidence(user: User, e: Evidence): Evidence & { redacted?: boolean } {
  if (canReadEvidence(user, e)) return e
  return {
    ...e,
    title: 'Restricted evidence',
    description: 'Content withheld. Your role cannot read restricted evidence.',
    source: 'Restricted',
    fileName: null,
    redacted: true,
  }
}
