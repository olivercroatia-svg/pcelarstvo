# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## The application

"Moj Pčelinjak" — a mobile-first PWA for Croatian beekeepers: hive records, statutory obligations,
honey production and traceability, sales and economics. Every screen is drawn at 390 px first.

**UI text is Croatian; code, comments and commit messages are English.**

Comments carry `§N` references (~775 of them). They point at sections of the 68-part scenario
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

# repo root
scripts/backup.sh   # mysqldump + uploads tarball; cron target on the VPS (§56)
```

Local dev DB is `moj_pcelinjak_dev`; config lives in the git-ignored root `.env`, which both the
app and `migrate.cjs` read.

`ANTHROPIC_API_KEY` and `GROQ_API_KEY` are **optional** and absent on the dev machine. Without them
the AI layer reports itself unavailable and everything else works — see § The AI layer below.

### Tests

There is no test suite in the repository. Verification is (a) end-to-end bash scripts that drive
the API with `curl`, written per stage and kept in the session scratchpad, and (b) manual
click-through at 390×844.

Six things that will otherwise cost you an hour:

- **TypeScript does not check SQL.** A query with a wrong column name typechecks perfectly and
  fails at runtime. Run every new query against the dev DB before believing it — seven of the
  assistant's tool queries were wrong on the first pass (`colonies` has no `deleted_at`,
  `queens.year` not `birth_year`, `harvests` has no `total_kg` at all). One throwaway node script
  that executes each query catches all of them in seconds.
- **Assert deltas, not absolutes.** The dev DB keeps state between runs, so "stock is 259.20 kg"
  breaks on the second run while "stock dropped by exactly 5.4 kg" keeps working.
- **Suites are order-dependent.** `test-scheduler.sh` leaves one `test_rok_*` obligation rule
  `active`, which makes `test-etapa2.sh` count 4 obligations instead of 3. Deactivate leftovers
  between runs; a failure right after another suite is usually this, not a regression.
- **HTTP 429 mid-suite is the rate limiter, not a regression.** 300 req/min globally, 20 logins/15
  min on the auth routes, 10/hour shared by `/me/export` and `DELETE /me` — all in-memory, so
  restarting the backend clears them. Running two suites back to back reliably trips it; restart
  between them. `test-etapa6.sh` alone spends 8 of its 10, so it does not survive a second run.
- **`set -o pipefail` plus `grep -q` is a lie detector that lies.** `grep -q` exits on its first
  match and closes the pipe; whatever was writing takes SIGPIPE, and `pipefail` reports the
  pipeline as failed *because the match was found*. This cost an hour twice in one afternoon — once
  in `scripts/backup.sh` (a capability probe that answered "unsupported" on every server that
  supported it) and once in a test harness, where every assertion whose match sat early in a 1 MB
  export "failed" while the one match near the end passed. Match with `case "$haystack" in
  *"$needle"*)` instead; no pipe, no signal, no puzzle.
- **`UID` is readonly in bash.** `UID=$(…)` fails with one line of stderr that scrolls past, then
  every `WHERE id='$UID'` runs against the empty string and *passes vacuously*. Any shell variable
  a test uses to hold a captured id should be named something bash does not already own.

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
   file. In the AI layer the same rule is enforced **by omission**: a worker's assistant roster
   simply does not contain the `economics` tool, because a tool that exists and refuses is one
   prompt away from a leak while a tool that was never registered is not.
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
- **Money that is counted rather than entered is an integer.** `ai_usage.cost_micros` is a
  `BIGINT` of micro-euros; a token costs ~0.000002 € and summing a month of those in a float is how
  a ledger disagrees with itself. Entered amounts (a sale, an expense) stay `DECIMAL` — they are
  typed by a human at two decimals and read back at two.
- Cross-module questions live in a `lib/` module so two screens can never give different answers:
  `commerce.ts` (kg and € per apiary), `production.ts` (harvest ↔ withdrawal cross-check),
  `obligations.ts` (which rule applies), `varroa.ts` (thresholds), `lot.ts` (LOT codes),
  `ai.ts` (the spend cap and the model call).

### Regulation is data, not code (§54)

`legal_obligations` → `user_obligations`, plus `season_tasks` and `subsidy_programs`. Nothing in
`lib/obligations.ts` names a single Croatian regulation. Changing a deadline is an UPDATE through
`/api/admin` and the `Admin*` screens, not a deploy. Do not hardcode a date, a form name or a rule
into a route.

### The AI layer (§13, §18, §31, §39, §44–§46)

Everything that talks to a model goes through `lib/ai.ts`. Three rules, and breaking any of them is
a defect:

1. **AI output is a draft, never a record.** There is deliberately no `ai_extracted_*` table — a
   draft that survives in the database is one someone will mistake for a record. Voice entry writes
   a hive inspection, a photographed VMP box writes a product, a receipt writes an expense, and all
   of them do it through the **ordinary module route** after a human pressed save, with that
   human's `created_by`. §13 demands the confirmation step in as many words; the OCR paths are held
   to the same standard.
2. **Every call is metered before it is made.** `guard()` reads the farm's month-to-date spend
   *before* the request, and again on **every iteration** of the assistant's tool loop — a loop
   that checks only at the start can spend the month in one conversation. The §56 rate limiter
   counts requests, which is the wrong unit here: one request can cost a hundred times another.
3. **The layer must never become a dependency of the register.** No key, switch off, provider down,
   cap reached — each leaves an application that still records an inspection and prints a
   declaration. Screens ask `useAiStatus()` **before drawing a button**, so an unconfigured
   installation shows no affordance rather than one that answers 503.

Other things worth knowing before touching it:

- Model and prices are constants in `lib/ai.ts` (`claude-sonnet-5`); the **cap and the switches are
  administrable** in `ai_settings`, because the moment they need changing is a cost incident. A
  price is a fact about a vendor, not a decision this application makes.
- The assistant runs a **hand-written tool loop**, not the SDK's Tool Runner. The runner is beta and
  this is the one path where an unbounded loop spends money.
- Tools are read-only and every one closes over `req.farm.id`. The model picks *which* tool and with
  what arguments — never whose data. Tool input is untrusted model output, handled like a body.
- §13's accuracy comes from **step two, not the transcriber**: the raw transcript goes to Claude
  with the farm's own hive codes and VMP names read out of the database. The STT provider sits
  behind `transcribe()` in `lib/voice.ts` and is one file to swap.
- §44 must not diagnose. That constraint is the feature, not a caveat on it.

### Personal data: export and erasure (§56)

`lib/gdpr.ts` is one table map and two functions over it, reached through `GET /api/me/export` and
`DELETE /api/me`. No migration — stage 6 added no tables, which is the point.

- **The map is the feature.** An export is worth something only if it is complete, and completeness
  is a property of the list, not of the loop that walks it. A table added by a later module and
  forgotten here fails nothing and silently omits a chapter, so every table in the schema must
  appear in either the map or the exported `SHARED_REFERENCE` set — and `test-etapa6.sh` asserts
  exactly that against `information_schema`. **If you add a table, add it to one of the two lists.**
- **`SELECT *`, deliberately.** Rows go to the person they are about, so a wildcard cannot
  over-disclose. The one exception is `users.password_hash`, and `users` is handled by name.
- **§4 applies here too.** The export is role-shaped: an owner gets the farm, a worker gets their
  account and the rows they wrote. Handing a worker the farm's sales ledger would be a §4 bypass
  wearing a compliance badge.
- **Erasure means the data stops being personal, not that forty tables are truncated.** Identity
  fields are overwritten — account, farm identity, customers' names and OIBs, the apiary
  coordinates §56 exists to protect — uploaded scans are unlinked from disk, and the farm is
  soft-deleted, which removes it from every query at once because every route already filters
  `deleted_at IS NULL`. `audit_logs` survives (čl. 17(3)(b)); after this runs its `user_id` no
  longer resolves to a name.
- **Never build an identifier from a prefix of a UUIDv7.** The anonymised address was
  `CONCAT('obrisan-', LEFT(id, 8), …)` until two accounts registered seconds apart collided on
  `users.uq_users_email` — v7 begins with a timestamp, so the prefix is shared, not unique. The
  transaction rolled back and the second deletion failed *after* the user was told it could not be
  undone. Use the whole id.
- Files are unlinked **after** the commit, never inside it: a file system error must not roll back
  an erasure the user has already been told is irreversible. Failures are logged with their paths.

### Migrations

`migrations/NNN_name.sql`, applied once and checksummed. Editing an already-applied file only prints
a warning and does not re-run — **add a new file instead**. MySQL has no `ADD COLUMN IF NOT EXISTS`,
so guarded ALTERs use the `information_schema` + `PREPARE`/`EXECUTE` idiom already in
`006_commerce.sql`. One migration per stage: 001 base/auth, 002 apiaries, 003 health, 004 legal,
005 production, 006 commerce, 007 AI.

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
- **Ask before you draw.** Anything that costs a model call consults `useAiStatus()` first and
  renders nothing when the layer is unavailable. Offering a button that answers 503 wastes the
  beekeeper's time twice.
- Observation vocabularies live in `lib/inspectionOptions.ts`, shared by the manual and the voice
  form. Two copies of these labels drift, and a beekeeper reading "Jaka" on one screen and "Jako"
  on the other has been given two vocabularies for one observation.
- **The root address serves two audiences.** `RequireAuth` renders `Landing` (§65, §66) when the
  path is exactly `/` and nobody is signed in; any deeper link still redirects to `/prijava`,
  because someone who asked for `/kosnice/12` wants that screen after signing in, not a sales
  pitch. `Landing` and `Privacy` are lazy for the same reason as the public jar page — a beekeeper
  opening the installed PWA must not download marketing copy on the way to the dashboard.
- `pages/Privacy.tsx` is written from the schema, not from a template: the three outbound services
  it names (Open-Meteo, Groq, Anthropic) are the three the backend really calls, and the stored-data
  list is the table list. **Add an outbound call, add it there.** The controller block at the top is
  blank on purpose and the page renders a visible warning until it is filled.

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

Stages 0–6 are complete: foundation and auth, apiary core with QR and offline entry, health and
statutory obligations, production and traceability, commerce and season, AI layer, landing page and
GDPR. Remaining: **7 — deploy via `myDeploy-Hetzner`**.

Two things stage 6 left for the deploy rather than solving in code, because neither belongs in the
application: **HTTPS** is Nginx and Let's Encrypt (the code side is already right — `secure` cookies
under `NODE_ENV=production`, HSTS from helmet's defaults), and **the backup cron** is a line in
`crontab` pointing at `scripts/backup.sh`, with `BACKUP_REMOTE` set to an rclone target. A backup
sitting on the same disk as the database survives a bad migration and nothing else.

Load the `claude-api` skill before changing anything in the AI layer — model IDs, pricing and the
request surface move, and this file records decisions rather than the current API.

**Not yet verified, and it needs a person with keys:** no real model call has ever been made from
this repository. Stage 5 is verified for graceful absence, the spend cap, role separation and route
behaviour — all of which hold without a key — but the *quality* of what comes back (how well a
crumpled Croatian receipt reads, how well Croatian beekeeping speech transcribes) is untested. Set
`ANTHROPIC_API_KEY` and `GROQ_API_KEY`, then photograph one VMP box and dictate one inspection
before trusting any of it.

**Also needs a person, not a commit:** the privacy notice names no controller until someone fills
the `OPERATOR` block in `pages/Privacy.tsx`, and the text should be read by a lawyer before the
domain is public. The page shows a warning banner while those fields are blank, so it cannot ship
unnoticed.

The full plan, including the per-stage verification scenarios, lives at
`~/.claude/plans/uvezi-design-iz-linka-vivid-squirrel.md`.
