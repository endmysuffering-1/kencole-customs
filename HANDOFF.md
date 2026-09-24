# Kencole Customs Brokerage — build handoff

A B2B + B2C customs brokerage and import management platform for a licensed
customs broker in The Bahamas. This package contains the schema, the domain and
service layers, a development seed and the `/api/v1` routes. The UI is not built yet.

## What is here and working

**Data model** — `prisma/schema.prisma`. 40 models covering identity and RBAC,
businesses, shipments and line items, HS codes and configurable rates, customs
declarations, quotes, invoices, payments, plans and pricing rules, procurement,
delivery, CRM, exceptions and an append-only audit log.

**Domain layer** — pure, dependency-free, unit tested.

| File | What it does |
| --- | --- |
| `src/lib/domain/landed-cost.ts` | Per-line duty/VAT/levy calculation with effective-dated rate resolution |
| `src/lib/domain/pricing.ts` | Kencole's own fee rules, scoped business → plan → list price |
| `src/lib/domain/shipment-state.ts` | Status machine with broker-approval and payment guards |
| `src/lib/domain/classification.ts` | HS suggestion from broker history and keywords, with a review threshold |
| `src/lib/domain/exceptions.ts` | Missing paperwork, value drift, duplicates, stuck queues |
| `src/lib/money.ts` | Decimal money, cent-exact allocation across lines |

**Service layer** — `src/lib/services/`. Shipment creation, estimation,
transitions, quoting, invoicing, payment recording, revenue reporting,
classification decisions, role changes (`user-service.ts`) and rate changes
(`rate-service.ts`). A rate is never edited in place: a change closes the current
rule and opens a new one, so historic entries still recalculate on the rate they
were assessed under. Changes that must be audited write the change and the audit
record in one transaction (`recordAudit(entry, tx)`).

**Provider boundaries** — `src/lib/providers/`. Storage (local + S3 interface),
payments (manual + Stripe interface), invoice extraction (mock + external),
notifications (console/Resend, SMS and WhatsApp interfaces), and the customs
adapter.

**Auth and audit** — `src/lib/auth/` (scrypt passwords, hashed session tokens,
capability + ownership checks) and `src/lib/audit.ts`.

**Tests** — 174 passing. Run `npm test`. Pure suites cover landed cost, pricing
scope (BUSINESS > PLAN > GLOBAL), RBAC and cross-tenant access, and the state
machine. Integration suites in `tests/integration/` run the real services
against Postgres: revenue separation, audit reasons (classification and rate
changes), tenancy and role escalation, transition guards, reference allocation,
and double-submit races. Each fix they guard was checked by re-breaking it and
watching the suite fail.

The integration suites need Postgres. Each run drops and recreates a dedicated
test database — `DATABASE_URL` with `_test` appended, or `TEST_DATABASE_URL` —
and refuses any database whose name does not end in `_test` or that is not local
(`TEST_DB_ALLOW_NON_LOCAL=1` overrides the second).

**Seed data** — `prisma/seed.ts`. A development dataset: 22 users covering every
`Role` (5 consumers, 5 businesses with an owner and an importer each, 7 staff),
10 suppliers, and 30 shipments that between them sit in all 20 `ShipmentStatus`
values, with the quotes, invoices, payments, documents, declarations, deliveries
and exception flags each status implies. Each seeded commercial invoice is a
small one-page PDF written to storage and stamped as sample data, so the broker
review screen has something to show. Every shared account password is
`DEV_PASSWORD` at the top of the file, and printed at the end of the run.

Shipments are one-line scenarios naming a target status. The seed replays the
happy path up to it and checks every hop against `canTransition`, so it cannot
produce a shipment the state machine would have refused. Figures come from the
real engine (`calculateLandedCost`, `calculateBrokerCharges`, `loadRateBook`),
suggestions from the app's own `KEYWORD_RULES`, references from the app's own
allocator — nothing is hand-typed.

It refuses to run with `NODE_ENV=production`, or against a non-local database
unless `SEED_ALLOW_NON_LOCAL=1`, because the accounts it creates share a
password that is in the repository. It also refuses a database that already has
users; `npm run db:reset` wipes and reseeds.

**API** — `src/app/api/v1/`. Handlers are thin: parse with zod, check the
session, call a service, return JSON. `src/lib/api/respond.ts` turns service
errors into responses. Every list and read goes through the scopes in
`src/lib/services/shipment-queries.ts`, and a record someone may not see is 404,
not 403. Customer responses omit machine suggestions, exception flags, internal
notes and internal status names. Each quoted government charge carries
`unverified` from its rate rule.

| Route | Who |
| --- | --- |
| `POST auth/register`, `POST auth/login`, `POST auth/logout`, `GET auth/me` | anyone / signed in |
| `POST estimate`, `GET hs-codes?q=` | public |
| `GET, POST shipments` · `GET, PATCH shipments/:id` | signed in, scoped; customers edit until review starts |
| `POST shipments/:id/transitions` | staff; `SUBMITTED_TO_CUSTOMS` needs the broker; a customer may only withdraw early |
| `POST shipments/:id/quotes` · `POST quotes/:id/accept` | `quote:issue` · the customer, broker-approved quotes only |
| `POST documents/upload` · `GET documents/:id` | owner or staff (multipart; type checked against the bytes) |
| `POST classification/suggestions` · `POST classification/decisions` | `classification:suggest` · `classification:approve` |
| `GET, POST invoices` · `GET invoices/:id` · `GET invoices/:id/payment-instructions` · `POST invoices/:id/payments` | scoped · `invoice:issue` · owner · `payment:record` |
| `GET rates` · `POST rates` · `POST rates/:id/supersede` | `rates:read` · `rates:edit` (rates as stored: 0.35 for 35%) |
| `GET users` · `POST users/:id/role` · `POST users/:id/access` | `users:manage`, reason required on every change |

Accepting a quote, moving the shipment to `AWAITING_PAYMENT` and raising the
invoice happen in one transaction. A payment that settles an invoice moves the
shipment to `PAID`. Only USD and BSD are accepted until exchange rates are
configurable (TODO in `schemas.ts`).

**Reference numbers** — `src/lib/services/references.ts`. Shipment, quote and
invoice references come from `ReferenceCounter`, advanced atomically, so a number
is never issued twice or re-issued after a delete. Years are taken in
`America/Nassau` time.

**UI** — `src/app/`. Server components call the services directly through the
same scopes as the API; client components post to `/api/v1`. Every private page
starts with `pageUser()` (`src/lib/auth/page.ts`): signed out goes to sign in, and
a page outside the user's role is 404.

| Page | Who | What |
| --- | --- | --- |
| `/` | public | The landed-cost calculator, pricing live from the rate table, with a tariff search and permit warnings |
| `/login`, `/register` | public | Personal or business accounts |
| `/dashboard`, `/shipments/new`, `/shipments/:id` | customers | Open a shipment, upload the invoice, see the estimate, accept a broker-reviewed quote, get bank-transfer instructions, follow the timeline |
| `/ops`, `/ops/shipments/:id` | operations, broker | Work queues by stage with time in status against `STALE_HOURS`, open exceptions by severity, unpaid invoices; status moves, suggestions, quoting and payment recording |
| `/broker`, `/broker/review/:id` | broker only | Lines to classify and entries to submit; the document on the left, lines on the right, approve / modify / raise exception |
| `/admin/rates` | operations and broker read; broker and administrator change | The government rate table: in force, scheduled and superseded, with how many are still unverified. Change a rate from a date, or add one for a heading or chapter |
| `/admin/users` | administrator only | Every account, searchable by name, email, role and status. Change a role or deactivate / restore an account |

The rules the screens keep:

- A customer only ever sees `CUSTOMER_LABEL` and `CUSTOMER_MILESTONES` wording,
  and sees a tariff code only once a broker has approved it.
- `ChargeBreakdown` is the one place charges are drawn. Government charges and
  Kencole's fees are separate blocks with separate subtotals, and every charge
  from an unconfirmed rate carries an "Unverified rate" mark and a footnote.
- On the broker screen, approving the code on the table needs no reason.
  Approving a different code is sent as a modification, and a modification or an
  exception needs a reason; the service enforces the same rule.
- A rate is never edited. Changing one closes the current rule and opens its
  successor, from now or from a date (midnight in Nassau), and needs a reason.
  Marking a rate confirmed needs a citation. Adding a rule over goods a live rule
  already covers is refused; change that rule instead. Kencole's own fees are
  pricing rules and are not on this screen.
- Deactivating an account ends all its sessions at once. Nobody can change their
  own role or access, and only an administrator can change another
  administrator's. Granting the broker role shows a warning that it carries the
  licensed capabilities.
- Ochre and teal appear only on money: badges, links and focus rings are ink.
- The operations queues are defined in `OPS_QUEUES`
  (`src/lib/services/ops-queries.ts`). HANDOFF named "ops queues" without
  listing them; the grouping by stage is a first cut to adjust with the team.

## Two invariants the code is built around

1. **No regulatory rate is hardcoded.** Every duty, VAT and levy rate lives in
   `ChargeType` + `RateRule` rows. `RateRule.confirmed` defaults to `false`, and
   any charge computed from an unconfirmed rule comes back in
   `result.unverifiedCharges` so the UI can mark it as unverified. Changing a
   rate is a database operation. So is deciding whether a charge is computed per
   line or once per entry (`ChargeType.level`): the engine supports both and
   takes no view on which a given Bahamian charge is.

2. **Government money is never Kencole revenue.** Duty and VAT collected for the
   Public Treasury are a liability. `Invoice.governmentTotal` and
   `Invoice.brokerTotal` are separate columns, and `revenueBetween()` in
   `invoice-service.ts` is the only function that produces a revenue figure — it
   reads `brokerTotal` only.

A third one worth stating: the software suggests classifications, it does not
decide them. `readyForDeclaration()` gates `DECLARATION_PREPARED` and
`SUBMITTED_TO_CUSTOMS` on every line carrying `BROKER_APPROVED`, and only the
`CUSTOMS_BROKER` role holds `classification:approve` and `declaration:submit` —
not even `SUPER_ADMIN`, since administering the system is not holding the licence.

## Not built yet

- Staff screens for pricing rules (Kencole's fees), plans and a full audit log
  viewer. Rate and access changes show their own recent history
- Ending a heading or chapter rate without replacing it. Today it can only be
  superseded; ending one would let those goods fall back to the chapter or
  general rate, which needs its own reason-and-audit path
- Inviting staff. Staff accounts come from the seed; an administrator can change
  an existing account's role but not create one
- Resolving an exception by hand. Flags are recomputed on every change; there is
  no "dismiss with a reason" action yet
- A production path for loading reference data (charge types, rates, HS codes,
  plans). Today only the seed creates it, and the seed will not run in production
- Refunds. Cancelling a shipment voids invoices with nothing paid against them;
  an invoice with money received is left alone for a refund flow to handle
- Delivery driver interface, procurement module, CRM screens, analytics
- README with install/deploy instructions

## Getting it running

```bash
npm install
cp .env.example .env          # set DATABASE_URL and SESSION_SECRET
npx prisma migrate dev --name init
npm run db:seed
npm test
npm run dev                   # http://localhost:3000
```

Seeded sign-ins (password `DEV_PASSWORD` in `prisma/seed.ts`): `admin@kencole.bs`
(administrator), `broker@kencole.bs` (licensed broker), `ops@kencole.bs`
(operations), `simone.pinder@example.com` (a consumer with shipments at several
stages).

`npm run db:reset` drops the database, reapplies every migration and reseeds —
`prisma migrate reset` runs the seed itself. Node 20.12 or later is required
(the seed uses `process.loadEnvFile`).

`prisma generate`, `migrate dev`, the seed script, `npm run typecheck`,
`npm test` and `npm run build` all run clean against this schema in a real
Postgres database. The screens were checked in Chromium against the seeded
data, including one customer taken from sign-up to paid entirely through the UI.

## Hosted preview

A preview runs on Vercel (project `kencole-customs-preview`) against Supabase
(project `kencole-customs-preview`, US East). It holds the demo data only.

- **Database.** The app connects as its own role, `kencole_app`, which owns a
  private `kencole` schema. That schema is not exposed through Supabase's data
  API, and `anon` / `authenticated` have no rights on it. Connections go through
  the Supavisor pooler (`aws-0-us-east-1`): port 6543 in transaction mode for
  the app, port 5432 in session mode for migrations.
- **Build.** `scripts/vercel-build.sh` runs `prisma migrate deploy`, seeds once
  if `SEED_PREVIEW=1` (it was, for the first deploy only; it is now `0`), then
  builds. A schema change reaches the preview by deploying it.
- **Files.** `STORAGE_PROVIDER=database`: documents live in the `StoredObject`
  table, because a serverless function has no disk that persists. Vercel caps a
  request body at 4.5 MB, so larger uploads fail on the preview.
- **Accounts.** Seeded with a password that is not in the repository. It is not
  stored in Vercel either; ask whoever set the preview up.
- **Environment variables** (in Vercel, secrets marked sensitive):
  `DATABASE_URL`, `MIGRATE_DATABASE_URL`, `SESSION_SECRET`,
  `STORAGE_PROVIDER=database`, `EMAIL_PROVIDER=console`, `SEED_PREVIEW=0`.
- **Access.** Vercel Authentication is on, so only members of the Vercel team
  can open it. Turn it off under Settings → Deployment Protection to share it.
  Supabase pauses free projects after a week without activity.

## Bahamas Customs items needing confirmation before production

Nothing in this codebase asserts a Bahamian rate. Before seeding real values,
confirm each against the current Tariff Act and Customs Management Regulations,
and set `RateRule.confirmed = true` with a `sourceNote` citing the instrument:

- Import duty rates per tariff heading
- VAT rate and the exact base it applies to (whether duty and levies are included)
- Environmental levy — scope, rates, and which headings attract it
- Customs processing fee — percentage, minimum and maximum, and whether the
  minimum and maximum apply per entry or per line (`ChargeType.level`; seeded as
  `SHIPMENT`, which is also unconfirmed)
- Excise and stamp duty, where applicable
- Which headings require a permit, and from which agency
- De minimis thresholds and personal exemption allowances

The Customs Management (Amendment) Regulations 2025 provisions reviewed
separately — FDCC, cruising permits, anchorage fees — apply to pleasure vessels
and pleasure aircraft, not to commercial air or sea freight. The Third Schedule
fuel surcharges on lightering and bunkering are the part of that instrument
relevant to a freight cost base.

## Design direction

Colour encodes who receives the money: ochre `#A9791C` for government charges,
teal `#0E6E6B` for Kencole charges, never decoratively. Base is deep navy
`#0C1B2A` on a pale `#EEF1F0`. One typeface (Archivo) with tabular figures on
every money column.

The logo is the gold Kencole script. On the site it is recoloured, white on
navy in the header and navy on the pale footer, because its gold sits too
close to the ochre that marks government charges. The supplied original and
the script that makes every version are in `design/brand/`; the outputs are in
`public/brand/`. The header uses a slightly thickened copy
(`-small`), since the brush strokes go hairline below about 80px tall. The public hero is the landed-cost calculator itself rather
than a headline — finding out what an import actually costs is the most
characteristic moment in this product. Tokens are in `tailwind.config.ts`.
