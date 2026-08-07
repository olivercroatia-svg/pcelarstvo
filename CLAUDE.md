# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## The application

"Moj Pčelinjak" — a mobile-first PWA for Croatian beekeepers: hive records, statutory obligations,
honey production and traceability, sales and economics. Every screen is drawn at 390 px first.

**UI text is Croatian; code, comments and commit messages are English.**

Comments carry `§N` references (~630 of them). They point at sections of the 68-part scenario
Oliver supplied when the project was planned. **That document is not in the repository** — the
comment is the surviving record of the requirement, so read it before changing the behaviour it
describes, and keep the reference when you move code.

## Commands

There is no root `package.json`. Run everything from `backend/` or `frontend/`.

```bash
# backend/
npm run dev         # tsx watch → 127.0.0.1:3001
npm run typecheck   # tsc --noEmit
npm run build       # tsc → dist/
npm run migrate     # node migrate.cjs — applies migrations/*.sql, each exactly once

# frontend/
npm run dev         # Vite :5173, proxies /api → 127.0.0.1:3001
npm run build       # tsc -b && vite build
npx tsc -b          # typecheck only — there is no `typecheck` script here
npm run lint        # oxlint (currently warnings only, exit 0)
```

Local dev DB is `moj_pcelinjak_dev`; config lives in the git-ignored root `.env`, which both the
app and `migrate.cjs` read.

### Tests

There is no test suite in the repository. Verification is (a) end-to-end bash scripts that drive
the API with `curl`, written per stage and kept in the session scratchpad, and (b) manual
click-through at 390×844.

Two things that will otherwise cost you an hour:

- **Assert deltas, not absolutes.** The dev DB keeps state between runs, so "stock is 259.20 kg"
  breaks on the second run while "stock dropped by exactly 5.4 kg" keeps working.
- **HTTP 429 mid-suite is the rate limiter, not a regression.** 300 req/min globally plus 20
  logins/15 min on the auth routes, both in-memory — restarting the backend clears them.

## Architecture

```
backend/     Express 4 + TS (ESM — imports carry the .js extension) + mysql2, no ORM
frontend/    Vite + React 19 + TS + Tailwind v4 + shadcn-style primitives
migrations/  numbered SQL, applied by backend/migrate.cjs
design/      imported Claude Design prototype — screen-flow reference only, never built or imported
uploads/     runtime file storage, git-ignored
```

### Request pipeline

Each layer adds exactly one thing:

```
attachUser    server.ts, global      → req.user or nothing; never rejects
requireAuth   server.ts, per mount   → 401
requireFarm   inside each router     → req.farm = { id, role }
requireOwner  commerce routers       → 403 for a worker
```

`requireFarm` resolves the farm from `farm_members`. **No route ever accepts a farmId from the
client**, and every query filters on `req.farm.id` — that one rule is the whole tenancy boundary.

### Three access rules that cut across modules

Breaking one of these is a defect, not a style preference.

1. **§4 — money is owner-only, enforced at the router.** `requireOwner`, never a hidden UI element.
   The commerce routers are grouped together in `server.ts` for exactly this reason. Analytics in
   kilograms stays open to workers, which is why `routes/economics.ts` splits `economicsRouter` (€)
   from `analyticsRouter` (kg). If a euro sign appears in an analytics response, it is in the wrong
   file.
2. **§26 — inspection mode reads no commerce table.** `routes/inspection.ts` is the screen handed to
   an inspector; the rule is enforced by its SELECT lists.
3. **§56 — GPS and uploaded documents never leave through a public route.** `/api/public`
   (`routes/traceability.ts`) is the only unauthenticated data route in the application, and what it
   may reveal is fixed by its own SELECT list. Photos and documents stream through authenticated
   Express routes, never through Nginx.

### Data invariants

- Primary keys are UUIDv7 as `CHAR(36)` (`lib/ids.ts`), always server-generated.
- Soft delete (`deleted_at`) plus `audit_logs` for anything an inspector may ask about. VMP
  treatments are never hard-deleted; a correction writes a new audit row.
- **A quantity is stored once.** Derived amounts are MySQL STORED generated columns —
  `honey_batches.available_kg = total_kg - packed_kg - sold_bulk_kg`,
  `packaging_batches.remaining_count = jar_count - sold_count`. Never add a second column meaning
  the same thing.
- **Money is derived, never stored twice.** No `total` on `sales`, no `honey_kg` on `sale_items` —
  both computed in `lib/commerce.ts`.
- **Stock has exactly two code paths: create and reverse.** Sale lines are not editable; a
  correction is delete (which returns stock) then re-enter. Both paths `SELECT … FOR UPDATE` the row
  that carries the counter, so check and decrement cannot drift.
- Cross-module questions live in a `lib/` module so two screens can never give different answers:
  `commerce.ts` (kg and € per apiary), `production.ts` (harvest ↔ withdrawal cross-check),
  `obligations.ts` (which rule applies), `varroa.ts` (thresholds), `lot.ts` (LOT codes).

### Regulation is data, not code (§54)

`legal_obligations` → `user_obligations`, plus `season_tasks` and `subsidy_programs`. Nothing in
`lib/obligations.ts` names a single Croatian regulation. Changing a deadline is an UPDATE through
`/api/admin` and the `Admin*` screens, not a deploy. Do not hardcode a date, a form name or a rule
into a route.

### Migrations

`migrations/NNN_name.sql`, applied once and checksummed. Editing an already-applied file only prints
a warning and does not re-run — **add a new file instead**. MySQL has no `ADD COLUMN IF NOT EXISTS`,
so guarded ALTERs use the `information_schema` + `PREPARE`/`EXECUTE` idiom already in
`006_commerce.sql`. One migration per stage: 001 base/auth, 002 apiaries, 003 health, 004 legal,
005 production, 006 commerce.

### Frontend

- Provider order in `main.tsx` is load-bearing: Theme → Toast → Confirm → Auth → Outbox.
- `useResource(path | null)` is the only data hook — GET plus `reload()`, deliberately not TanStack
  Query. A `null` path skips the fetch, which is how role-gated cards avoid a 403:
  `useResource(current?.role === 'owner' ? '/economics' : null)`.
- The base path is declared once in `vite.config.ts` and read everywhere through
  `import.meta.env.BASE_URL` (router basename, `lib/api.ts`, PWA manifest). Never hardcode
  `/programs/moj-pcelinjak/`.
- **Offline is append-only.** The Dexie outbox (`lib/outbox.tsx`) queues new records; editing
  requires a connection. Extending it to updates would need CRDTs or per-field versioning — out of
  proportion to the problem.
- **PDFs are browser print CSS** (`@page`, `print:hidden`), not a PDF library — see `Declaration`,
  `FormPreview`, `AnnualReport`.
- **Charts are hand-rolled SVG and divs** (`components/Chart.tsx`). No chart library; that was a
  bundle-size decision, not an oversight.
- Croatian formatting lives in `lib/format.ts` — comma decimals, dot thousands, U+2212 minus, and
  `plural()` for the three Croatian plural forms. Use it rather than `toLocaleString`.
- Status colours are semantic tokens: `text-ok | text-caution | text-warning | text-critical`, both
  themes defined in `index.css`. Do not reach for a raw palette value.
- `<Disclaimer />` carries the §55 wording — never retype that paragraph into a screen.
- Heavy routes are lazy (ZXing scanner, print pages). Check `components/lazy.tsx` before adding a
  static import of a large dependency.

## What "done" means here

1. `backend: npm run typecheck` and `frontend: npx tsc -b` both clean.
2. The stage's scenario clicked through the **UI at 390×844** — not only curl.
3. Console clean, no horizontal scroll.
4. č/ć/š/ž/đ correct in the UI, in MySQL (utf8mb4) and in printed output.

## The repository is public

`olivercroatia-svg/pcelarstvo` is public, and `uploads/` holds scanned rješenja, laboratory findings
and hive photos that carry an OIB, a home address and apiary surroundings. Screenshot rules in
`.gitignore` are anchored to the root (`/*.png`) on purpose — a blanket `*.png` would also swallow
`frontend/public/pwa-*.png` and `src/assets/hero.png`, which the build needs. Check `git status`
before every commit.

## Stage plan

Stages 0–4 are complete: foundation and auth, apiary core with QR and offline entry, health and
statutory obligations, production and traceability, commerce and season. Remaining: **5 — AI layer**
(load the `claude-api` skill before writing any of it; the speech-to-text provider is still an open
decision), **6 — landing page and GDPR**, **7 — deploy via `myDeploy-Hetzner`**.

The full plan, including the per-stage verification scenarios, lives at
`~/.claude/plans/uvezi-design-iz-linka-vivid-squirrel.md`.
