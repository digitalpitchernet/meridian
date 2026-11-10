# Meridian Repository Operations Guide

**Document ID:** MER-OPS-001  
**Version:** 0.1  
**Status:** Working baseline — operational guidance  
**Product:** Meridian  
**Repository:** `digitalpitchernet/meridian`  
**Created:** 10 November 2026

> This guide defines the working rules for the Meridian source repository and its human and AI contributors. It does not replace the Product Charter, Product Principles, Architecture records, Module Specifications or founder-approved decisions.

## 1. Repository purpose

This repository is the version-controlled source of truth for Meridian's product documentation, application source, tests, database migrations, connector code and implementation evidence.

The repository must contain the materials needed to understand, develop, test and maintain Meridian without depending on private chat history.

The local development folder is a working copy. GitHub is the shared collaboration and review surface. A successful upload is not, by itself, proof that the application is correctly integrated or release-ready.

## 2. Authority and decision rights

- The Founder is the final approval authority for product identity, scope, material UX direction, architecture, data/security policy, commercial decisions and releases.
- Architecture and product recommendations must be supported by evidence, explicit assumptions and documented trade-offs.
- Coding agents may inspect, implement and test approved work. They must not silently convert proposals into product decisions.
- Material decisions must be recorded in the relevant canonical document or decision register.
- A commit, pull request or document version change does not itself constitute founder approval.

## 3. Documentation hierarchy

Use the most specific applicable authority:

1. **Product Charter** — identity, purpose, customer, promise and scope boundaries.
2. **Product Principles** — enduring product, UX, data, security and engineering principles.
3. **Architecture records** — system boundaries, components, data flows and technical decisions.
4. **Module Registry and Module Specifications** — module responsibilities, boundaries, behaviour and acceptance criteria.
5. **Decision Register / ADRs** — approved decisions, rationale, alternatives and consequences.
6. **Roadmap and implementation records** — planned work and verified delivery state.
7. **Code, tests and evidence** — what is actually implemented and demonstrated.

When sources disagree, do not silently choose one. Identify the conflict, establish which source is authoritative, and request a decision where needed.

## 4. Branch and change workflow

### Branch roles

- `main` — canonical integration branch. It should contain reviewed, coherent work. Do not use it as a scratch branch.
- `local/main` — temporary import/staging name for the original local application history during repository recovery. It is not intended to become a permanent development branch.
- `style/nolan-refinement` — visual refinement workstream from the original local repository. Preserve its original history during migration.
- `feat/<short-name>`, `fix/<short-name>`, `style/<short-name>`, `docs/<short-name>` — focused branches for subsequent work.

The migration branches are staging references. Their existence does not mean their contents have been reviewed, reconciled or merged into `main`.

### Change rules

- Prefer small, focused commits with descriptive messages.
- Use pull requests for changes proposed for `main`.
- Do not force-push, rewrite shared history, delete branches or overwrite remote references without explicit approval.
- Do not merge unrelated Git histories until the migration plan has been reviewed and the intended merge strategy is explicit.
- Keep the original local branches and recovery bundle until the migrated repository has been independently verified.
- Do not remove the uploaded ZIP until the source tree, commit history and recovery artifacts have all been verified. Its eventual removal should be a separate, deliberate cleanup change.

## 5. Documentation and implementation discipline

Before implementation, the contributor must identify:

- the relevant product decision, principle or specification;
- the intended outcome and acceptance criteria;
- scope and explicit non-goals;
- affected modules, data models and integrations;
- security, privacy and migration implications;
- the tests and evidence required.

After implementation:

- update affected specifications and implementation status;
- distinguish implemented, partially implemented, unverified and deferred work;
- record material deviations and unresolved issues;
- attach or reference meaningful test evidence;
- do not mark a feature complete solely because its UI is visible.

A discussed idea is not an approved requirement. A proposed feature is not implemented. A passing test is evidence only for the behaviour it actually exercises.

## 6. Security and repository hygiene

- Never commit `.env`, service-role keys, database passwords, private API keys, OAuth secrets, production credentials or private user data.
- `.env.example` may contain names and safe placeholders only. It must never contain a secret value. Public client identifiers or publishable keys must be explicitly identified and reviewed before inclusion.
- Keep local databases, scratch data, caches, build output and temporary test files out of version control unless they are intentionally curated test fixtures or evidence.
- Review new files and diffs for secrets before every push or pull request.
- If a credential is accidentally committed or exposed, treat it as compromised and rotate it. Removing it in a later commit does not undo exposure.
- Do not run destructive database operations or migrations against a live project without explicit approval and a verified recovery plan.

## 7. Database and data-layer rules

- Treat applied database migrations as immutable.
- Prefer forward-only migrations with clear, ordered filenames.
- Test migrations against a disposable or explicitly designated test project before proposing release.
- Document schema changes, data backfills, rollback/recovery considerations and affected application code.
- Never assume local development data represents production data.
- Keep secrets and privileged service credentials on trusted server-side boundaries; do not expose them in browser code.

## 8. Testing and evidence

Choose tests according to the change. Relevant layers may include:

- unit and component tests;
- application workflow tests;
- SQL, policy and database tests;
- connector and HTTP tests;
- migration and recovery drills;
- accessibility, responsive and visual regression checks;
- manual acceptance checks where automation is not practical.

Report what was run, the result, environment limitations and any tests not run. Do not claim a test passed unless it was actually executed and its result observed.

## 9. AI-agent operating contract

AI coding agents working in this repository must:

1. Read this guide and the root-level agent instructions before editing.
2. Inspect the current branch, working-tree status and relevant files before acting.
3. Preserve unrelated user changes.
4. Avoid broad refactors when the task calls for a focused change.
5. Never invent product approvals, implementation status, test results or credentials.
6. Ask before destructive actions, history rewrites, production changes or scope expansion.
7. Summarise files changed, decisions made, commands/tests run and remaining risks.
8. Leave a clear handoff so another agent or human can continue without relying on hidden conversation context.

## 10. Release readiness

A release proposal should establish:

- the intended version and scope;
- approved product and architecture decisions;
- completed module acceptance criteria;
- test and security evidence;
- migration and backup readiness;
- known limitations and operational requirements;
- founder approval.

A merged pull request is not automatically a production release.

## 11. Change history

| Version | Date | Change |
|---|---|---|
| 0.1 | 10 November 2026 | Initial repository operating guidance. |

---

**Operating principle:** preserve history, make decisions explicit, verify implementation, and keep the Founder in control of consequential changes.
