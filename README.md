# Meridian (DPN): V1 engineering foundation

Gate 1 package: database, security model, financial engine, storage connector and their tests.
Application (M1: shell, Command Centre, Projects, Tasks on fictional development data, no backend connected): [app/README.md](app/README.md). Run `node tools/serve.mjs`.

- Spec: [docs/ENGINEERING-SPEC.md](docs/ENGINEERING-SPEC.md)
- Gate 1 report (results, limitations, founder approvals): [docs/GATE-1-REPORT.md](docs/GATE-1-REPORT.md)
- Connector and hosting guide: [connector/README.md](connector/README.md)

## Reproduce

Requirements: a new, empty Supabase project; PostgreSQL 17 client tools; Node 20+; PHP 8.1+ with pdo_sqlite and curl.

1. `cp .env.example .env` and fill the values for your project (`.env` is git-ignored).
2. Apply `supabase/migrations/*.sql` in filename order as `postgres` (Supabase CLI `supabase db push`, or psql with `--single-transaction -f` per file).
3. SQL suites: run `tests/sql/00_harness.sql`, `01_fixtures.sql`, then `10`, `20`, `30`, `40` in a SQL session as `postgres`. Results land in `qa.results`. `21_concurrency.sql` needs two parallel sessions (see its header).
4. HTTP suite: `node tests/http/run.mjs` → `evidence/http-results.json`. It expects the fixture users from step 3.
5. Connector: `php tests/connector/run.php` → `evidence/connector-results.json`.
6. Recovery drill into a second empty project: `node tests/recovery/drill.mjs` → `evidence/recovery-drill.json`.

Verify file integrity with `sha256sum -c MANIFEST.sha256`.

Rules: forward-only migrations; never edit an applied migration; never run migrations as `supabase_admin`;
drop the `qa` schema from anything that is not a disposable test project.
