# Migrations

This directory contains SQL migration files for the Memory Layer service.

## Usage

Migrations are run using `memory-layer/scripts/runMigrations.ts`.

To run migrations:

```bash
DATABASE_URL=postgres://user:password@localhost:5432/dbname npx ts-node memory-layer/scripts/runMigrations.ts memory-layer/sql/migrations
```

## Creating Migrations

1. Create a new `.sql` file in `memory-layer/sql/migrations/`.
2. Name it with a prefix that ensures correct ordering (e.g., `004_description.sql`).
3. Ensure the migration is idempotent (use `IF NOT EXISTS`).
4. Wrap the migration in a transaction (`BEGIN; ... COMMIT;`).
