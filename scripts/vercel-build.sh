#!/usr/bin/env bash
# Build for a hosted preview (Vercel). Applies pending migrations, seeds once
# if asked, then builds the app.
#
#   DATABASE_URL          runtime connection (a transaction pooler is fine)
#   MIGRATE_DATABASE_URL  a session-mode connection for migrate and seed, which
#                         need advisory locks and prepared statements
#   SEED_PREVIEW=1        seed demo data; skipped if the database has users.
#                         Needs SEED_PASSWORD (not the committed dev password).
#                         Remove both once the preview is seeded.
set -euo pipefail

npx prisma generate

if [ -n "${MIGRATE_DATABASE_URL:-}" ]; then
  DATABASE_URL="$MIGRATE_DATABASE_URL" npx prisma migrate deploy
fi

if [ "${SEED_PREVIEW:-}" = "1" ]; then
  # The seed refuses NODE_ENV=production and any non-local database by default.
  # This is the one deliberate exception, and it still insists on SEED_PASSWORD.
  DATABASE_URL="$MIGRATE_DATABASE_URL" NODE_ENV=development SEED_ALLOW_NON_LOCAL=1 npx tsx prisma/seed.ts
fi

npx next build
