
import fs from 'fs';
import path from 'path';
import { Client } from 'pg';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const migrationsDir = args[0];
  const mode = args.includes('--mode=mock') ? 'mock' : 'real';

  if (!migrationsDir || migrationsDir.startsWith('--')) {
    console.error('Usage: npx ts-node runMigrations.ts <migrations-dir> [--mode=mock]');
    process.exit(1);
  }

  console.log(`Using migrations directory: ${migrationsDir}`);

  if (mode === 'mock') {
    console.log('Running in MOCK mode. Validating migration files only.');
    if (!fs.existsSync(migrationsDir)) {
      console.error(`Migrations directory does not exist: ${migrationsDir}`);
      process.exit(1);
    }
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    console.log(`Found ${files.length} migration files.`);
    for (const file of files) {
       console.log(`[MOCK] Would apply ${file}`);
       // Validate we can read it
       fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    }
    console.log('Mock migrations check passed.');
    process.exit(0);
  }

  const client = new Client({
    connectionString: databaseUrl,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined
  });

  try {
    await client.connect();
    console.log('Connected to database.');

    // Ensure migrations directory exists
    if (!fs.existsSync(migrationsDir)) {
      console.error(`Migrations directory does not exist: ${migrationsDir}`);
      process.exit(1);
    }

    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    // Create schema_migrations table if not exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name VARCHAR PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    console.log(`Found ${files.length} migration files.`);

    for (const file of files) {
      // Check if already applied
      const res = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
      if (res.rows.length > 0) {
        console.log(`Skipping ${file} (already applied).`);
        continue;
      }

      console.log(`Applying ${file}...`);
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf-8');

      try {
        // Run migration in a transaction block?
        // If the file has BEGIN/COMMIT, we shouldn't nest.
        // But we want to update schema_migrations atomically with the migration.
        // Assuming migration files handle their own transactions (BEGIN/COMMIT) which seems to be the case,
        // we can't easily wrap them.
        // We will execute the migration, then insert into schema_migrations.
        // This leaves a small risk if insert fails, but acceptable for this simple runner.
        // Alternatively, we could require migrations NOT to have BEGIN/COMMIT and wrap them here.
        // The existing files HAVE BEGIN/COMMIT. So we run them as is.

        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        console.log(`Applied ${file}.`);
      } catch (err) {
        console.error(`Error applying ${file}:`, err);
        process.exit(1);
      }
    }

    console.log('All migrations applied successfully.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
