# Kencole Customs Brokerage — build handoff

A B2B + B2C customs brokerage and import management platform for a licensed
customs broker in The Bahamas. This package contains the schema and the domain
layer. The UI, API routes and seed are not built yet.

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
classification decisions.

**Provider boundaries** — `src/lib/providers/`. Storage (local + S3 interface),
payments (manual + Stripe interface), invoice extraction (mock + external),
notifications (console/Resend, SMS and WhatsApp interfaces), and the customs
adapter.

**Auth and audit** — `src/lib/auth/` (scrypt passwords, hashed session tokens,
capability + ownership checks) and `src/lib/audit.ts`.

**Tests** — `tests/landed-cost.test.ts`, 15 passing. Run `npm test`.

## Two invariants the code is built around

1. **No regulatory rate is hardcoded.** Every duty, VAT and levy rate lives in
   `ChargeType` + `RateRule` rows. `RateRule.confirmed` defaults to `false`, and
   any charge computed from an unconfirmed rule comes back in
   `result.unverifiedCharges` so the UI can mark it as unverified. Changing a
   rate is a database operation.

2. **Government money is never Kencole revenue.** Duty and VAT collected for the
   Public Treasury are a liability. `Invoice.governmentTotal` and
   `Invoice.brokerTotal` are separate columns, and `revenueBetween()` in
   `invoice-service.ts` is the only function that produces a revenue figure — it
   reads `brokerTotal` only.

A third one worth stating: the software suggests classifications, it does not
decide them. `readyForDeclaration()` gates `DECLARATION_PREPARED` and
`SUBMITTED_TO_CUSTOMS` on every line carrying `BROKER_APPROVED`, and only the
`CUSTOMS_BROKER` role holds the `classification:approve` capability.

## Not built yet

- Seed data (`prisma/seed.ts`) — needed before anything runs end to end
- All UI: public site, calculator, consumer dashboard, ops queues, broker review
- API routes under `/api/v1/`
- Remaining tests: pricing, RBAC/IDOR, state machine, revenue separation
- Delivery driver interface, procurement module, CRM screens, analytics
- README with install/deploy instructions

## Getting it running

```bash
npm install
cp .env.example .env          # set DATABASE_URL and SESSION_SECRET
npx prisma migrate dev --name init
npm test
```

Prisma's engine binaries could not be downloaded in the environment where this
was built, so `prisma generate` has not been run against this schema and the
files importing `@prisma/client` have not been typechecked. Expect to fix a
handful of type errors on the first `npx prisma generate && npm run typecheck`.

## Bahamas Customs items needing confirmation before production

Nothing in this codebase asserts a Bahamian rate. Before seeding real values,
confirm each against the current Tariff Act and Customs Management Regulations,
and set `RateRule.confirmed = true` with a `sourceNote` citing the instrument:

- Import duty rates per tariff heading
- VAT rate and the exact base it applies to (whether duty and levies are included)
- Environmental levy — scope, rates, and which headings attract it
- Customs processing fee — percentage, minimum and maximum
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
