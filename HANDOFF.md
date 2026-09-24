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

**Tests** — 116 passing. Run `npm test`. Pure suites cover landed cost, pricing
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
and exception flags each status implies. Every shared account password is
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

Accepting a quote, moving the shipment to `AWAITING_PAYMENT` and raising the
invoice happen in one transaction. A payment that settles an invoice moves the
shipment to `PAID`. Only USD and BSD are accepted until exchange rates are
configurable (TODO in `schemas.ts`).

**Reference numbers** — `src/lib/services/references.ts`. Shipment, quote and
invoice references come from `ReferenceCounter`, advanced atomically, so a number
is never issued twice or re-issued after a delete. Years are taken in
`America/Nassau` time.

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

- All UI: public site, calculator, consumer dashboard, ops queues, broker review
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
```

`npm run db:reset` drops the database, reapplies every migration and reseeds —
`prisma migrate reset` runs the seed itself. Node 20.12 or later is required
(the seed uses `process.loadEnvFile`).

`prisma generate`, `migrate dev`, the seed script, `npm run typecheck` and
`npm test` all run clean against this schema in a real Postgres database.

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
every money column. The public hero is the landed-cost calculator itself rather
than a headline — finding out what an import actually costs is the most
characteristic moment in this product. Tokens are in `tailwind.config.ts`.
