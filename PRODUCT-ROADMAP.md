# Meridian --- Product Roadmap

**Document ID:** MER-ROADMAP-001\
**Version:** 0.1\
**Status:** Working baseline --- pending founder review\
**Product:** Meridian\
**Parent organisation:** Digital Pitcher Networks (DPN)\
**Created:** 10 November 2026

> This roadmap defines the intended order of product work and the
> decision gates for moving between stages. It is deliberately
> milestone-based rather than date-based. The existing codebase has not
> yet been audited, so no phase below should be interpreted as a
> verified implementation status or a delivery-date commitment.

------------------------------------------------------------------------

## 1. Purpose

The Meridian Product Roadmap translates the Product Charter into a
practical sequence for product definition, implementation, validation
and release.

It is intended to:

-   Keep development focused on the initial product promise.
-   Establish the order in which foundational work should happen.
-   Make dependencies and decision gates visible.
-   Prevent speculative features from displacing essential product work.
-   Coordinate product, design, engineering and documentation.
-   Provide a shared reference for the founder, collaborators and AI
    coding agents.

This roadmap is a planning baseline. Detailed requirements, acceptance
criteria and technical decisions belong in their respective
specifications and decision records.

## 2. Roadmap principles

1.  **Audit before planning implementation in detail.** The existing
    application must be inspected before we decide what needs to be
    built, replaced or improved.
2.  **Build a coherent core before expanding.** Complete and connect the
    essential operating workflows before adding optional complexity.
3.  **Sequence by dependency, not excitement.** Data foundations,
    security and shared patterns should precede features that depend on
    them.
4.  **Validate each meaningful stage.** Progress is based on
    demonstrated outcomes and acceptance criteria, not the number of
    screens or prompts completed.
5.  **Avoid arbitrary dates.** Use explicit exit criteria; set delivery
    dates only when scope, capacity and dependencies are understood.
6.  **Protect the V1 boundary.** New ideas must be evaluated against the
    Product Charter and Product Principles.
7.  **Keep documentation aligned with reality.** Update implementation
    status only after inspecting and testing the delivered product.

## 3. Product baseline

The initial product direction is a single-workspace operating
environment for solo founders.

The established V1 product domains are:

-   Command Centre / Home.
-   Projects.
-   Tasks.
-   Calendar and Milestones.
-   Finances, initially using import-based entry.
-   Contacts.
-   Decisions.
-   Vault / Documents.
-   Reports.
-   Settings.

The established planning decisions include a single workspace, local and
Supabase-backed document storage, import-first financial entry, and a
vanilla frontend approach. These are approved planning directions
remembered from product work; they must be reconciled with the actual
repository before being treated as implementation facts.

Google Calendar, Gmail and Google Drive connections have been explored
as part of the planned personalisation and connected-workspace
experience. Their exact scope and sequencing remain subject to
integration, security and feasibility review.

## 4. Roadmap overview

  -----------------------------------------------------------------------
  Stage                   Focus                   Intended outcome
  ----------------------- ----------------------- -----------------------
  0                       Documentation and       A clear product
                          project orientation     baseline and working
                                                  documentation
                                                  structure.

  1                       Repository audit and    Verified understanding
                          implementation          of what exists and what
                          assessment              needs attention.

  2                       Architecture and V1     A stable, coherent
                          foundation              technical and data
                                                  foundation for the core
                                                  product.

  3                       V1 core workflows       Essential modules work
                                                  together as a useful
                                                  founder operating
                                                  environment.

  4                       Personalisation and     Setup and external
                          selected integrations   connections add value
                                                  safely and reliably.

  5                       Product validation and  The product is tested,
                          release readiness       understandable,
                                                  recoverable and ready
                                                  for a controlled
                                                  release.

  6                       Post-release learning   Improvements are driven
                          and considered          by real usage and
                          expansion               validated needs.
  -----------------------------------------------------------------------

The stages describe intended sequencing, not current completion. Stage 0
documentation has begun. The existing codebase audit remains
outstanding.

------------------------------------------------------------------------

## 5. Stage 0 --- Documentation and project orientation

**Status:** In progress\
**Objective:** Establish the product's written foundation before
substantial implementation work resumes.

### Work

-   Establish the Meridian project repository and preserve the existing
    application.
-   Keep `MERIDIAN_CONTEXT.md` at the repository root.
-   Establish the `docs/00-foundation/` directory.
-   Create and review:
    -   `MERIDIAN-CHARTER.md`
    -   `PRODUCT-PRINCIPLES.md`
    -   `PRODUCT-ROADMAP.md`
    -   `CANONICAL-LEXICON.md`
-   Establish a module registry and decision-record conventions.
-   Identify the relevant DPN organisational context without duplicating
    the DPN documentation repository.

### Exit criteria

-   The founder has reviewed and approved the foundational documents.
-   The repository structure is understood and preserved.
-   The distinction between approved decisions, proposals, deferred
    ideas and verified implementation is clear.
-   The project can be introduced to a new human or AI collaborator
    through its documentation.

### Not included

This stage does not require every future architecture or module document
to be written before the repository audit. Create detailed documents
when evidence and need justify them.

------------------------------------------------------------------------

## 6. Stage 1 --- Repository audit and implementation assessment

**Status:** Not started\
**Objective:** Establish an evidence-based picture of the current
Meridian application.

### Work

Inspect the actual repository, its configuration, application structure
and relevant running behaviour.

Assess:

-   Repository structure, branches and project configuration.
-   Frontend framework or implementation approach and dependency
    versions.
-   Existing routes, screens, navigation and shared components.
-   Existing modules and their actual behaviour.
-   Database schema, Supabase usage and data access patterns.
-   Authentication and authorisation.
-   Local and remote document storage.
-   Financial import capability.
-   Google integration code, if any.
-   Environment configuration and deployment process.
-   Tests, build health, runtime errors and known defects.
-   Accessibility, responsive behaviour and design consistency.
-   Security-sensitive flows and handling of credentials or user data.

### Required outputs

-   `CURRENT-STATE.md`
-   `IMPLEMENTATION-STATUS.md`
-   `KNOWN-ISSUES.md`
-   Initial verified architecture notes.
-   A gap analysis comparing the existing application with the approved
    V1 baseline.

### Implementation status vocabulary

Every major capability should be classified as one of:

-   `VERIFIED` --- Inspected and confirmed to work against its
    acceptance criteria.
-   `PARTIAL` --- Some behaviour exists, but the full requirement is not
    met.
-   `NOT IMPLEMENTED` --- Inspected and confirmed absent.
-   `UNVERIFIED` --- Evidence is insufficient to make a reliable claim.
-   `BLOCKED` --- Work cannot proceed because a dependency or decision
    is unresolved.

### Exit criteria

-   The current application state is documented with evidence.
-   Critical defects, risks and architectural constraints are
    identified.
-   Existing working functionality is distinguished from incomplete or
    conceptual work.
-   The founder has reviewed the gap analysis and agreed on the next
    priorities.

**Important:** Do not rewrite or replace working parts of the
application simply to make the code match a proposed architecture. First
understand what exists and why.

------------------------------------------------------------------------

## 7. Stage 2 --- Architecture and V1 foundation

**Status:** Planned; scope to be confirmed after Stage 1\
**Objective:** Resolve the foundational technical decisions and
stabilise the shared patterns required by the V1 product.

### Areas to assess and document

-   System architecture and application boundaries.
-   Data architecture and ownership of records.
-   Authentication, authorisation and workspace boundaries.
-   Supabase responsibilities and configuration.
-   Local and remote document storage behaviour.
-   Shared navigation, layout and component patterns.
-   Error handling, validation and loading states.
-   Import and export conventions.
-   Environment and deployment configuration.
-   Backup, recovery and data lifecycle.
-   Security and privacy controls.

### Potential work

The actual tasks will depend on the Stage 1 audit. They may include
correcting data boundaries, improving reliability, resolving critical
defects, standardising shared patterns or documenting existing
architecture without changing it.

### Exit criteria

-   Critical architecture questions have explicit decisions.
-   The data and security boundaries are understood.
-   Shared patterns are sufficiently stable for module-level work.
-   The build and test process is reproducible.
-   No unresolved foundational issue makes the core product unsafe or
    unreliable to extend.

------------------------------------------------------------------------

## 8. Stage 3 --- V1 core workflows

**Status:** Planned; sequence to be refined after the audit\
**Objective:** Deliver the essential founder workflows as one coherent
product.

The following is a planning breakdown, not a claim that any module is
currently missing or incomplete.

### 8.1 Workspace and navigation

Establish a reliable single-workspace experience, navigation, settings
and the overall application shell.

### 8.2 Projects and tasks

Support the organisation of projects and actionable work. Define how
tasks relate to projects, due dates, status and other relevant records.

### 8.3 Calendar and milestones

Provide a useful view of deadlines, milestones and commitments. Define
how calendar information relates to projects and tasks, and how
conflicts or missing dates are handled.

### 8.4 Contacts

Provide consistent records for relevant people and business
relationships, with useful links to projects and other business context
where appropriate.

### 8.5 Decisions

Preserve significant business decisions and their rationale so that
important context is not lost in conversations or personal notes.

### 8.6 Finances

Support the initial import-first financial workflow. Define accepted
formats, validation, mapping, duplicate handling, error reporting and
the distinction between imported records and manually entered or
calculated information.

Do not expand this into direct banking or accounting integrations
without a separate approval.

### 8.7 Vault and documents

Establish dependable document organisation and retrieval using the
approved local and Supabase-backed storage direction. Define file
metadata, access boundaries, sync behaviour, failure handling and
recovery.

### 8.8 Reports and Command Centre

Present useful operational visibility using traceable information from
the underlying modules. Avoid unsupported scores, vanity metrics or
summaries that conceal incomplete data.

### Cross-module acceptance

The core product should not be considered coherent merely because
individual screens exist. Verify that:

-   Records link correctly across relevant modules.
-   Data remains consistent when created or updated through different
    workflows.
-   Navigation and terminology are predictable.
-   Loading, empty, error and recovery states are handled.
-   Important actions provide clear feedback.
-   The founder can complete representative end-to-end workflows.

### Exit criteria

-   The approved V1 workflows meet their documented acceptance criteria.
-   Critical cross-module dependencies work reliably.
-   Data integrity and access boundaries have been tested.
-   The product provides a useful, coherent experience for its intended
    solo-founder audience.

------------------------------------------------------------------------

## 9. Stage 4 --- Personalisation and selected integrations

**Status:** Planned / subject to feasibility and scope approval\
**Objective:** Reduce setup friction and connect selected external
services where doing so materially improves the founder's workflow.

### Personalisation

Define a clear initial setup experience for relevant preferences and
workspace information. Previously explored personalisation fields
include:

-   User or founder name.
-   Cofounder information, where relevant.
-   Organisation name.
-   Currency and time-format preferences.
-   Logo upload.

The final setup sequence should be based on what the V1 product actually
requires. Do not force users to provide information that is not needed
to begin.

### Potential Google connections

The following connection areas have been explored:

-   Google Calendar.
-   Gmail.
-   Google Drive.

Before building each connection, specify:

-   The exact user problem and workflow.
-   Required OAuth scopes and why each is necessary.
-   Data read, write and synchronisation behaviour.
-   Conflict handling and source-of-truth rules.
-   Credential storage and revocation.
-   Rate limits, errors and service outages.
-   User-visible connection status and controls.
-   Privacy, retention and deletion behaviour.
-   Ongoing API and maintenance costs.

### Sequencing rule

Do not treat all three integrations as an indivisible launch
requirement. Evaluate and prioritise them individually. Build only when
the product value and operational responsibilities are clear.

### Exit criteria

-   Setup is understandable and can be completed without unnecessary
    friction.
-   Each approved integration has narrow, justified permissions.
-   Connection, disconnection, revocation, failure and recovery
    behaviour are tested.
-   External data does not silently overwrite authoritative user
    records.
-   The product remains useful when an external service is unavailable,
    where feasible.

------------------------------------------------------------------------

## 10. Stage 5 --- Product validation and release readiness

**Status:** Planned\
**Objective:** Establish that Meridian is dependable and understandable
for its intended initial users.

### Validation areas

-   End-to-end workflows using realistic founder scenarios.
-   Data correctness, import validation and duplicate handling.
-   Authentication and access-control checks.
-   Document upload, retrieval, failure and recovery.
-   Integration permissions and failure handling, if included.
-   Responsive layout and accessibility.
-   Performance and reliability under expected usage.
-   Error messages and user recovery paths.
-   Backup, export and deletion expectations.
-   Setup and onboarding comprehension.
-   Documentation and support readiness.

### Release readiness checklist

A controlled release should not proceed until:

-   Critical and high-impact defects have been resolved or explicitly
    accepted.
-   Core workflows pass their acceptance tests.
-   Security and privacy risks have been reviewed.
-   Data recovery and operational responsibilities are understood.
-   Environment configuration and deployment steps are documented.
-   No secrets are committed to the repository.
-   The product's limitations are known and communicated appropriately.
-   The founder approves the release scope.

### Exit criteria

A controlled release is approved and the team can support, observe and
improve the product responsibly.

------------------------------------------------------------------------

## 11. Stage 6 --- Post-release learning and considered expansion

**Status:** Future\
**Objective:** Improve Meridian using evidence from actual use rather
than speculative feature accumulation.

Potential areas for later evaluation include:

-   Improvements to existing modules and workflows.
-   Additional import and export formats.
-   More integrations where justified.
-   Optional industry packs.
-   Team collaboration and role management.
-   More advanced reporting.
-   Carefully scoped AI assistance or automation.
-   Broader deployment and workspace models.
-   Native mobile experiences.

These are future evaluation areas, not commitments or an automatic
post-release build list.

### Expansion gate

Before accepting a new capability, evaluate:

-   Evidence of repeated user need.
-   Alignment with the Product Charter.
-   Impact on product simplicity.
-   Architecture and data implications.
-   Security and privacy implications.
-   External dependencies and ongoing cost.
-   Maintenance and support burden.
-   Opportunity cost against improving the existing core.

------------------------------------------------------------------------

## 12. Explicitly deferred areas

Unless the founder approves a change, the following remain outside the
current V1 commitment:

-   Multi-workspace operation.
-   Full team collaboration and complex role management.
-   Autonomous AI agents or an agent marketplace.
-   Full CRM replacement.
-   Direct banking and accounting integrations.
-   Native mobile applications.
-   Broad autonomous automation.
-   Mandatory industry-specific workflows.

The reserved name **Jared** may be considered for a future Meridian AI
agent. This is not an approved roadmap item or V1 requirement.

------------------------------------------------------------------------

## 13. Prioritisation framework

When multiple items compete for attention, prioritise using the
following order:

1.  **Correctness and safety** --- Data integrity, security, access
    control and critical defects.
2.  **Foundational dependencies** --- Architecture, shared data patterns
    and reliability.
3.  **Core founder workflows** --- Capabilities required to deliver the
    product promise.
4.  **Workflow coherence** --- Cross-module relationships and reduced
    duplication.
5.  **Setup and integration value** --- Personalisation and external
    services with clear user benefit.
6.  **Polish and optimisation** --- Usability, accessibility,
    performance and refinement.
7.  **Expansion** --- New modules, industry packs and advanced
    capabilities supported by evidence.

This is a default ordering, not a substitute for assessing the severity
and urgency of a specific issue.

## 14. Roadmap governance

The roadmap should be updated when:

-   A stage is completed against its exit criteria.
-   An important dependency changes.
-   A material product decision changes the sequence or scope.
-   New evidence changes the priority of work.
-   Capacity or external constraints require reprioritisation.

Each significant roadmap change should record:

-   What changed.
-   Why it changed.
-   The decision owner and approval status.
-   The impact on scope, dependencies and other stages.
-   The related specifications or decision records that require updates.

Do not add arbitrary delivery dates without a credible scope, capacity
and dependency assessment.

## 15. Current state and immediate next actions

At the time this version was prepared:

-   Meridian's foundational documentation is being established.
-   The existing application is known to exist, but its current
    implementation state has not been audited in this planning process.
-   The exact repository structure and technical architecture still
    require inspection.
-   No roadmap stage beyond the documentation work should be marked
    complete without verification.

### Immediate sequence

1.  Review and approve the foundational documents.
2.  Establish the Canonical Lexicon and Module Registry.
3.  Bring the actual Meridian application repository into the working
    environment.
4.  Conduct the Stage 1 repository and implementation audit.
5.  Review the gap analysis and agree on the first implementation
    priorities.
6.  Refine Stages 2--5 using verified project evidence.

------------------------------------------------------------------------

## 16. Change log

  -----------------------------------------------------------------------
  Version                 Date                    Change
  ----------------------- ----------------------- -----------------------
  0.1                     10 November 2026        Initial milestone-based
                                                  roadmap created. No
                                                  delivery dates assigned
                                                  pending repository
                                                  audit.

  -----------------------------------------------------------------------

------------------------------------------------------------------------

**Guiding principle:** Meridian advances by proving that each layer is
useful, reliable and ready to support the next---not by accumulating
features or racing through an arbitrary schedule.
