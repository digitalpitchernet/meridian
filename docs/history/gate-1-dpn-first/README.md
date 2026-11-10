# Superseded: first DPN Gate 1 run (8 Nov 2026)

Project `meridian-g1-validation` (ref `ahphlozxsgifgwbtwoqb`, DPN). The nine migrations and the SQL suites ran
cleanly there (202 PASS, CONC-02 environment FAIL, 2 INFO). But the HTTP suite could not run: `tests/sql/01_fixtures.sql`
had inserted the test users directly into `auth.users`, leaving `confirmation_token`, `recovery_token`,
`email_change_token_new` and `email_change` NULL. Supabase Auth then failed to load them (HTTP 500, "converting NULL to
string is unsupported"), so H-AUTH-01..03 failed.

The users could not be recreated in place: workspaces A and B reference them with `ON DELETE RESTRICT` and the
no-delete guards (correctly) protect that history. With founder approval the run moved to a fresh project,
`meridian-g1-validation-clean` (`xwopffsacsctvjjwnxnw`), where users are created by `tests/http/provision-users.mjs`
through the Auth Admin API. The project above is preserved untouched; it was not deleted or reset.
