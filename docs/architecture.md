# Architecture

```text
┌──────────────────────────── Browser ─────────────────────────────┐
│ app/            React 19 routes (lazy-loaded), shell, case tabs  │
│ components/     primitives, clock rail, reasoning flow, ledger   │
│ lib/client/     api() with CSRF, session, formatting, ticker     │
│ lib/engine/     ── the same engine as the server ──              │
│                 what-if simulator · browser ledger verification  │
│                 · clock-event integrity check                    │
└──────────────────────────────┬───────────────────────────────────┘
                               │ JSON over same-origin HTTP
                               │ SameSite=Strict session cookie + X-CSRF-Token
┌──────────────────────────────▼───────────────────────────────────┐
│ server/  (Node 24, TypeScript run directly by type stripping)    │
│                                                                  │
│  Hono middleware                                                 │
│   requestId → accessLog → securityHeaders → rateLimit            │
│   → bodyLimit → originCheck → sessionLoader → csrfCheck          │
│                                                                  │
│  routes/  session · cases · reports · evidence · portfolio       │
│           ledger · ops (overview, clocks, analytics, settings)   │
│           imports · demo                                         │
│   ├ zod validation + text hygiene   (validation.ts, lib/text.ts) │
│   ├ RBAC + object-level authz       (lib/rbac.ts, authz.ts)      │
│   ├ analyzeCase() on every read     (lib/engine/analyze.ts)      │
│   └ writes in one transaction with their ledger entry            │
│                                                                  │
│  SQLite via node:sqlite   append-only triggers on history tables │
│  evidence object store    storage/evidence/ab/<sha256>           │
│  audit ledger             SHA-256 hash chain, one writer         │
└──────────────────────────────────────────────────────────────────┘
```

## Frontend

- **Vite + React 19 + TypeScript (strict) + Tailwind 3 + Motion.** Every route is a lazy chunk;
  React, Motion and TanStack Query are split into vendor chunks.
- **Server state** lives in TanStack Query. Every mutation invalidates every query, because most
  writes change a derived view somewhere else (a determination changes the overview, the clocks page,
  analytics and the ledger).
- **Time.** One shared one-second ticker drives every countdown. The server's clock is the
  reference: the offset measured from each response's `now` is applied to the ticker. Running
  deadline statuses are recomputed between fetches with the same attention thresholds the server
  uses (`lib/client/live.ts`).
- **Accessibility.** Semantic landmarks, roving-tabindex tabs, keyboard-navigable sidebar and
  command palette, focus-trapped dialogs, visible focus, status conveyed by icon + word + colour,
  `prefers-reduced-motion` honoured globally plus an in-app override.

## Backend

- **Hono** on `@hono/node-server`, bound to `127.0.0.1`. In development Vite proxies `/api`; in
  production the same server serves `dist/` with SPA fallback and the full CSP.
- **No build step.** Node 24 strips TypeScript types natively. The rules that follow (real `.ts`
  import extensions, `import type`, no enums, namespaces or parameter properties) are enforced by
  lint.
- **Dependency injection** of `now()` into every handler, so tests fix time.

## Data layer

- **SQLite through `node:sqlite`**: no native module, one file. Each table holds the domain object
  as JSON in `data` next to the columns that queries and foreign keys need.
- **Eleven history tables are append-only** (`clock_events`, `determinations`, `decisions`,
  `evidence`, `evidence_links`, `reports`, `report_transitions`, `reviews`, `comments`,
  `threat_intel`, `audit_events`). Triggers raise on UPDATE and DELETE.
- **Derived, not stored:** case status, the clock of record, deadlines, completeness, health, gaps,
  data quality, the reportability suggestion, VEX output. See [data-model.md](data-model.md).

## Rule engine

`lib/engine/` is pure: no DOM, no network, no wall clock. `analyzeCase(bundle, now)` builds the
clock, evaluates the transitional rule, computes deadlines, evaluates affectedness per product,
suggests reportability, checks completeness and data quality, derives status and health, and writes
the "why this decision" explanation. See [rule-engine.md](rule-engine.md).

## Evidence layer

Uploads are validated by content (magic bytes / UTF-8), hashed with SHA-256 on the server, and
stored content-addressed at `storage/evidence/<first two hex>/<sha256>`, outside any served path. The
evidence row, which is immutable, records the hash, size, sniffed MIME type, classification and
owner. Links from evidence to events, determinations, decisions and reports are append-only rows. The
download endpoint checks role and classification, and serves `attachment` with `nosniff` and a
sandbox CSP.

## Audit ledger

`server/ledger.ts#appendAudit` is the only writer. It runs inside the caller's transaction, so a
mutation and its ledger entry commit together. Entry hash = SHA-256(`prevHash` + `\n` + canonical
JSON of the entry). `lib/engine/ledger.ts#verifyChain` takes an injected hasher so the same verifier
runs with `node:crypto` on the server and Web Crypto in the browser.

## Authentication

Demo mode offers persona sign-in; password sign-in (scrypt) is available for accounts seeded with
`DEMO_PASSWORD`. Sessions are server-side rows keyed by the SHA-256 of a 32-byte token. A production
deployment would place an OIDC identity provider in front; that is on the roadmap, not implemented.

## Authorization

`lib/rbac.ts` holds the one permission matrix (9 roles × 25 permissions) plus the approval policy
per report kind. `server/context.ts#requirePermission` enforces it per route; `server/authz.ts`
adds the object-level rules (case ownership or collaboration for analysts and engineers; read-only
once a case is closed; restricted evidence).

## Reporting

A report version is generated from the live case record into plain-text sections, hashed, and stored
as an immutable row. Its stage (Draft → Internal review → Approved → Ready → Submitted →
Acknowledged → Closed) is derived from append-only transitions. Approval advances automatically when
the kind's policy is satisfied by reviewers other than the generator and the decision analyst.
Submission is simulated: it records a server-witnessed clock event and stores a simulated receipt as
evidence. Exports (HTML, Markdown, JSON) are rendered on the server with escaping appropriate to
each format.
