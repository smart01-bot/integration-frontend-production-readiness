#!/usr/bin/env node
/**
 * Migration runner — audit gap 29.
 *
 * Migrations were previously applied by pasting SQL into the Supabase editor
 * with no tracking, which is exactly how migration 017 sat unapplied for
 * weeks while the backend got debugged. This runner:
 *
 *   1. Creates a `schema_migrations` ledger table (idempotent).
 *   2. Applies every migrations/*.sql file (in filename order) that is NOT
 *      yet in the ledger, via the Supabase REST RPC -> Postgres. Files run
 *      through the `exec_sql` RPC defined in migrations/000_ledger.sql.
 *   3. Records each applied file in the ledger; `status` and `npm run
 *      migrate:status` make applied/unapplied state a query, not archaeology.
 *
 * Usage:
 *   node scripts/migrate.js            # apply pending migrations
 *   node scripts/migrate.js --status   # just show the ledger vs files
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env (the service key
 * is required — the runner must bypass RLS to manage the ledger).
 */
import { createClient } from '@supabase/supabase-js';
import { readdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';

const args = process.argv.slice(2);
const STATUS_ONLY = args.includes('--status');

const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPA_URL || !SUPA_KEY) {
  console.error('migrate: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (.env)');
  process.exit(1);
}

const supabase = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });

// ── 1. Ensure ledger table exists (raw SQL via a throwaway rpc-free path) ──
async function ensureLedger() {
  // The ledger bootstrap SQL is idempotent and safe to re-run; it lives in
  // migrations/000_ledger.sql so it is itself tracked once applied.
  const { error } = await supabase.rpc('exec_sql', {
    query: `
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        id           SERIAL PRIMARY KEY,
        filename     TEXT NOT NULL UNIQUE,
        applied_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        applied_by   TEXT NOT NULL DEFAULT 'migrate.js',
        success      BOOLEAN NOT NULL DEFAULT TRUE,
        error_detail TEXT
      );`
  });
  return error;
}

async function appliedFiles() {
  const { data, error } = await supabase
    .from('schema_migrations')
    .select('filename, applied_at, success');
  if (error) {
    console.error('migrate: cannot read schema_migrations ledger —', error.message);
    process.exit(1);
  }
  return new Map((data || []).filter(r => r.success).map(r => [r.filename, r.applied_at]));
}

async function run() {
  // Bootstrap the ledger first (000_ledger.sql creates exec_sql + the table;
  // the CREATE TABLE above is attempted best-effort for already-bootstrapped DBs).
  const bootstrapErr = await ensureLedger();
  if (bootstrapErr && bootstrapErr.code !== 'PGRST202') {
    // PGRST202 = rpc not found yet — expected on a fresh DB before 000 runs.
    console.error('migrate: ledger bootstrap issue —', bootstrapErr.message);
  }

  const applied = await appliedFiles().catch(() => new Map());
  const dir = join(process.cwd(), 'migrations');
  const files = readdirSync(dir)
    .filter(f => f.endsWith('.sql') && f !== 'README.md')
    .sort();

  const pending = files.filter(f => !applied.has(f));

  console.log(`migrate: ${files.length} migration files, ${applied.size} applied, ${pending.length} pending`);

  if (STATUS_ONLY) {
    for (const f of files) {
      const state = applied.has(f) ? 'applied ' + applied.get(f) : 'PENDING';
      console.log(`  ${f.padEnd(50)} ${state}`);
    }
    process.exit(0);
  }

  for (const file of pending) {
    // 000_ledger.sql must run outside the ledger itself (chicken-and-egg):
    // it creates exec_sql + schema_migrations, then records itself.
    const sql = readFileSync(join(dir, file), 'utf8');
    console.log(`migrate: applying ${file} ...`);

    if (file === '000_ledger.sql') {
      // Cannot use exec_sql to create exec_sql. The bootstrap file is plain
      // idempotent SQL — instruct the operator for this one-time step.
      console.error('migrate: 000_ledger.sql must be applied once manually in the Supabase SQL editor (it creates the exec_sql helper the runner uses). After that, this runner handles everything.');
      process.exit(2);
    }

    const { error } = await supabase.rpc('exec_sql', { query: sql });
    if (error) {
      console.error(`migrate: FAILED ${file} —`, error.message);
      await supabase.from('schema_migrations').insert({
        filename: file, success: false, error_detail: error.message
      }).then(() => {}, () => {});
      process.exit(1);
    }

    const { error: recErr } = await supabase
      .from('schema_migrations')
      .insert({ filename: file, success: true });
    if (recErr) {
      console.warn(`migrate: applied ${file} but failed to record it —`, recErr.message);
    } else {
      console.log(`migrate: OK ${file}`);
    }
  }

  console.log('migrate: done');
  process.exit(0);
}

run();
