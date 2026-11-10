# Meridian --- Canonical Lexicon

**Document ID:** MER-LEX-001\
**Version:** 0.1\
**Status:** Working baseline --- pending founder review\
**Product:** Meridian\
**Parent organisation:** Digital Pitcher Networks (DPN)\
**Created:** 10 November 2026

> This document establishes the preferred meaning of important Meridian
> product terms. Its purpose is to keep product discussions,
> specifications, interface copy, data models and implementation work
> consistent across people and AI agents. It is a terminology authority,
> not a database schema or a complete functional specification.

------------------------------------------------------------------------

## 1. Purpose and usage

Meridian uses a shared vocabulary across its interface, documentation
and implementation.

When a term is defined here:

-   Use it consistently in product discussions and documentation.
-   Do not introduce a competing term for the same concept without an
    explicit decision.
-   Do not assume two similar-sounding terms represent the same data
    object.
-   Use the preferred term in UI labels where it is appropriate and
    understandable.
-   If a term is unclear or a new concept is required, propose a
    definition before using it as an established product concept.

This lexicon distinguishes between **canonical terms**, **provisional
labels** and **reserved names**.

### Term status

  -----------------------------------------------------------------------
  Status                              Meaning
  ----------------------------------- -----------------------------------
  `CANONICAL`                         Preferred term and definition
                                      established in this working
                                      baseline; subject to founder
                                      approval.

  `PROVISIONAL`                       Working label that may change after
                                      design or product review.

  `RESERVED`                          Name or term set aside for possible
                                      future use; not an approved
                                      feature.

  `UNDER REVIEW`                      Meaning or product treatment
                                      requires a future decision.
  -----------------------------------------------------------------------

Version 0.1 is pending founder approval. No entry should be treated as
permanently locked until explicitly approved.

------------------------------------------------------------------------

## 2. Organisational and product terms

### 2.1 Meridian

**Status:** `CANONICAL`

The founder operating system being developed as an independently branded
venture incubated within Digital Pitcher Networks (DPN).

Use `Meridian` for the product and its product identity. Do not use
`Founder OS` as the current product name except when referring to its
earlier working title or historical documentation.

### 2.2 DPN

**Status:** `CANONICAL`

Digital Pitcher Networks, the parent venture-building organisation that
creates, owns and operates a portfolio of ventures, subject to
applicable legal arrangements.

DPN is not a Meridian module or customer-facing feature.

### 2.3 Founder

**Status:** `CANONICAL`

The person building or operating a business who uses Meridian to
organise and understand their work.

The term describes the intended initial user context. It does not imply
that every Meridian user must legally hold the title of founder.

### 2.4 Organisation

**Status:** `CANONICAL`

The business or operating entity whose information the founder manages
in Meridian.

An Organisation is conceptually distinct from a Workspace. The initial
product may store organisation details within a single workspace, but
the terms should not be used interchangeably.

### 2.5 Workspace

**Status:** `CANONICAL`

The primary working environment in which a user organises their Meridian
information and activities.

The established initial product direction is **one workspace**.
Workspace is not synonymous with Organisation, user account, project or
application installation.

### 2.6 User

**Status:** `CANONICAL`

A person who accesses Meridian through an account or authenticated
session.

A Founder is a user in the intended initial use case, but the terms are
not interchangeable in every context.

### 2.7 Venture

**Status:** `CANONICAL`

An independently identified product or business initiative developed,
incubated, owned or operated within the DPN portfolio.

Meridian is one DPN venture. A venture is not automatically a separate
legal entity.

------------------------------------------------------------------------

## 3. Product structure and navigation

### 3.1 Module

**Status:** `CANONICAL`

A major functional area of Meridian that groups related capabilities,
workflows and information.

Examples include Projects, Tasks, Finances, Contacts, Decisions and
Vault.

A module is a product-level organisational boundary. It is not
necessarily a separate application, service, code repository or
database.

### 3.2 Feature

**Status:** `CANONICAL`

A specific user-facing capability or behaviour within a module or across
modules.

A feature should solve a defined user problem and have an identifiable
scope and acceptance criteria.

### 3.3 Workflow

**Status:** `CANONICAL`

A sequence of related actions through which a user completes a task or
achieves an outcome.

A workflow may involve more than one module.

### 3.4 Command Centre / Home

**Status:** `PROVISIONAL`

The primary overview experience intended to help the founder understand
current activity, priorities and relevant signals.

`Command Centre` is a working product/design label from earlier
planning. The final navigation label and screen composition remain
subject to the approved screen specification. Do not treat this term as
a separate data module unless the architecture explicitly requires one.

### 3.5 Navigation

**Status:** `CANONICAL`

The interface structure through which users move between Meridian's
modules, views and workflows.

### 3.6 Industry Pack

**Status:** `CANONICAL`

An optional, industry-oriented extension that adapts Meridian's
general-purpose foundation to a particular business context through
additional terminology, workflows, fields, templates or capabilities.

An Industry Pack is not automatically a separate product or a mandatory
part of the core.

------------------------------------------------------------------------

## 4. Core operating concepts

### 4.1 Project

**Status:** `CANONICAL`

A defined initiative or body of work that groups related tasks,
milestones, documents, decisions and other relevant context around an
intended outcome.

A Project is broader than an individual task. It may contain many tasks
and milestones.

### 4.2 Task

**Status:** `CANONICAL`

An actionable unit of work that can be assigned a description, status,
due date and other relevant details.

A Task may be associated with a Project, but the detailed relationship
and whether standalone tasks are supported must be specified in the
module requirements.

### 4.3 Milestone

**Status:** `CANONICAL`

A significant point, target date or achievement within a Project or
broader operating plan.

A Milestone represents meaningful progress or a deadline; it is not
simply another name for a Task or calendar event.

### 4.4 Calendar Event

**Status:** `CANONICAL`

A time-based occurrence or commitment with a date and, where relevant, a
start time, end time, location or participants.

A Calendar Event describes something happening at a particular time. A
Milestone describes a significant target or point of progress. Their
exact relationship and shared calendar presentation require
specification.

### 4.5 Contact

**Status:** `CANONICAL`

A person or external business relationship recorded for reference and
use in relevant workflows.

A Contact is not necessarily a Meridian User. The product should
distinguish internal account access from a stored business relationship.

### 4.6 Decision

**Status:** `CANONICAL`

A recorded choice made by the founder or an authorised decision-maker,
ideally accompanied by its context, rationale, date and relevant
implications.

A Decision record preserves why a course of action was chosen. It is not
the same as a Task, which records work to be done.

### 4.7 Financial Record

**Status:** `CANONICAL`

A structured item of financial information recorded or imported into
Meridian for tracking, review or reporting.

The term is intentionally broad. Detailed record types---such as income,
expense, invoice, payment, budget or transaction---must be defined in
the Finances specification before being treated as equivalent or
interchangeable.

### 4.8 Report

**Status:** `CANONICAL`

A structured presentation or summary of information intended to help the
founder understand activity, performance or a particular business
subject.

A Report should be traceable to its underlying information and should
identify important assumptions or limitations.

### 4.9 Vault

**Status:** `CANONICAL`

The Meridian product area for storing, organising and retrieving
important business documents and files.

`Vault` is the product-facing concept. A file or document is an item
stored or referenced within it. The Vault is not synonymous with the
physical storage provider or storage infrastructure.

### 4.10 Document

**Status:** `CANONICAL`

A file or information resource that the user stores, uploads, creates or
references for business purposes.

A Document may have metadata, ownership, relationships and storage
information. A Document is not the same thing as a Vault, which is the
product area that organises documents.

### 4.11 Setting

**Status:** `CANONICAL`

A configurable preference or behaviour that affects the user's workspace
or Meridian experience.

A setting should have a clear scope and understandable effect.
Workspace, user and integration settings should be distinguished where
their ownership differs.

------------------------------------------------------------------------

## 5. Data, integration and technical terms

### 5.1 Record

**Status:** `CANONICAL`

A structured item of information maintained by Meridian, such as a
Project, Task, Contact or Financial Record.

A record is a general data concept, not a user-facing module name.

### 5.2 Source of Truth

**Status:** `CANONICAL`

The designated authoritative location or record for a particular piece
of information.

When information exists in multiple systems, the relevant specification
must identify which system is authoritative and how updates, imports or
synchronisation affect it.

### 5.3 Import

**Status:** `CANONICAL`

The process of bringing information from an external file or source into
Meridian.

Importing does not necessarily establish an ongoing connection or
synchronisation. Validation, mapping, duplicate handling and error
behaviour must be defined for each import workflow.

### 5.4 Integration

**Status:** `CANONICAL`

A defined connection between Meridian and an external service that
enables specified information or actions to pass between them.

An integration must have a documented purpose, permission model, data
flow, failure behaviour and user controls.

### 5.5 Synchronisation / Sync

**Status:** `CANONICAL`

A process that keeps specified information aligned between Meridian and
an external service according to defined rules.

Sync is not synonymous with import. A one-time import does not imply
ongoing synchronisation. Direction, conflict handling, timing and
source-of-truth rules must be specified.

### 5.6 Connected Account

**Status:** `CANONICAL`

An external service account that a user has explicitly authorised
Meridian to access for defined purposes.

A connected account does not imply unrestricted access to all
information or capabilities in that external service.

### 5.7 Local Storage

**Status:** `CANONICAL`

Storage held within the user's local application environment or device,
according to the actual architecture.

The exact meaning must be clarified in technical specifications---for
example, browser storage, a local file system or another local
persistence mechanism. Do not use this term as a substitute for a
verified implementation description.

### 5.8 Remote Storage

**Status:** `CANONICAL`

Storage provided by an external or network-accessible service, such as
the planned Supabase-backed storage direction.

The term describes the storage location, not the complete backup,
synchronisation or recovery strategy.

### 5.9 Supabase

**Status:** `CANONICAL`

The external backend platform selected in Meridian's planning for
relevant backend and storage capabilities.

The exact responsibilities assigned to Supabase must be documented in
the verified system and data architecture. Its mention here does not
certify that any particular service is currently configured or
operational.

### 5.10 Personalisation

**Status:** `CANONICAL`

The setup process through which a user supplies relevant identity,
organisation, regional or experience preferences so Meridian can
configure the workspace appropriately.

Personalisation should request only information needed for a clear
product purpose.

------------------------------------------------------------------------

## 6. Product lifecycle and documentation terms

### 6.1 Proposal

**Status:** `CANONICAL`

An idea or suggested change that has been raised for consideration but
has not yet been approved.

A Proposal is not an active product requirement.

### 6.2 Approved Decision

**Status:** `CANONICAL`

A decision explicitly accepted by the founder or designated decision
authority and recorded in the appropriate canonical documentation.

A discussion, recommendation or implementation prompt alone does not
constitute an Approved Decision.

### 6.3 Specification

**Status:** `CANONICAL`

A document that defines the expected behaviour, scope, constraints and
acceptance criteria for a product capability or system component.

A Specification describes what should be built or how something should
behave. It does not prove that the capability exists.

### 6.4 Implementation

**Status:** `CANONICAL`

The actual software, configuration or operational work that has been
carried out to realise an approved requirement.

Implementation status must be established by inspecting the repository
and testing the relevant behaviour.

### 6.5 Acceptance Criteria

**Status:** `CANONICAL`

Specific, verifiable conditions that must be satisfied for a feature,
workflow or deliverable to be accepted as complete.

Acceptance criteria should be testable and aligned with the approved
requirement.

### 6.6 Verified

**Status:** `CANONICAL`

A status used when the relevant implementation or behaviour has been
inspected and confirmed against defined criteria.

A visual appearance, code fragment or successful happy-path
demonstration alone may be insufficient verification.

### 6.7 Unverified

**Status:** `CANONICAL`

A status used when available evidence is insufficient to make a reliable
claim about implementation or behaviour.

Use `UNVERIFIED` rather than assuming a feature is complete or absent.

### 6.8 Deferred

**Status:** `CANONICAL`

A proposal or capability that may be valuable but is intentionally
excluded from the current scope or development sequence.

Deferred does not mean approved for future delivery.

### 6.9 Rejected

**Status:** `CANONICAL`

A proposal or approach that has been considered and explicitly decided
against.

A rejected item should not be reintroduced as an approved requirement
without a new decision.

------------------------------------------------------------------------

## 7. Reserved and provisional names

### 7.1 Jared

**Status:** `RESERVED`

A name reserved as a possible future AI agent within Meridian.

The reservation does not approve an AI agent, define its
responsibilities or place it within the V1 scope.

### 7.2 Command Centre

**Status:** `PROVISIONAL`

A previously used label for Meridian's primary overview experience. The
final product-facing name and detailed experience remain subject to
approval.

------------------------------------------------------------------------

## 8. Preferred terminology and distinctions

Use these distinctions to avoid ambiguity:

  -----------------------------------------------------------------------
  Prefer                  Do not use              Distinction
                          interchangeably with    
  ----------------------- ----------------------- -----------------------
  Workspace               Organisation            Workspace is the
                                                  product environment;
                                                  Organisation is the
                                                  business.

  User                    Founder                 User is an
                                                  account/access concept;
                                                  Founder describes the
                                                  intended initial
                                                  customer.

  Project                 Task                    Project groups work
                                                  around an outcome; Task
                                                  is an actionable unit.

  Milestone               Calendar Event          Milestone marks a
                                                  significant target or
                                                  achievement; Calendar
                                                  Event is time-based.

  Contact                 User                    A Contact need not have
                                                  a Meridian account.

  Decision                Task                    Decision records a
                                                  choice; Task records
                                                  work.

  Vault                   Document                Vault is the product
                                                  area; Document is an
                                                  item stored or
                                                  referenced there.

  Import                  Sync                    Import brings
                                                  information in; Sync
                                                  maintains alignment
                                                  under defined rules.

  Integration             Connected Account       Integration is the
                                                  product connection;
                                                  Connected Account is
                                                  the authorised external
                                                  account.

  Proposal                Approved Decision       A Proposal is under
                                                  consideration; an
                                                  Approved Decision has
                                                  explicit approval.

  Specification           Implementation          A Specification
                                                  describes expected
                                                  behaviour;
                                                  Implementation is what
                                                  has actually been
                                                  built.

  Planned                 Verified                Planned work is not
                                                  evidence of delivered
                                                  functionality.
  -----------------------------------------------------------------------

------------------------------------------------------------------------

## 9. Rules for introducing new terms

Before introducing a new canonical term:

1.  Confirm that the concept is genuinely distinct.
2.  Search this lexicon and existing specifications for an equivalent
    term.
3.  Prefer clear, familiar language over internal jargon.
4.  Define the term in one or two precise sentences.
5.  Identify related terms and important distinctions.
6.  Decide whether it is a product-facing label, a technical concept or
    both.
7.  Add it to this document with a status and, where useful, an example.
8.  Update affected specifications and interface language.

Do not create multiple names for the same concept merely because
different modules or contributors use different language.

Where a technical term differs from the user-facing label, document both
explicitly.

## 10. Change control

Changes to canonical terminology should be deliberate.

Each material change should record:

-   The term added, changed or retired.
-   Its previous and revised definitions.
-   The reason for the change.
-   The affected modules, specifications, UI labels or data structures.
-   The approval status and date.

If a term changes after implementation, identify any migration,
compatibility or documentation consequences before applying the change.

## 11. Current approval state

Version 0.1 is a working terminology baseline pending founder review.

Some terms describe established product planning decisions; others are
deliberately provisional because their detailed behaviour or final
interface naming has not yet been approved.

This lexicon does not define database tables, API contracts, exact field
names, module permissions or implementation status. Those belong in the
relevant architecture and module specifications.

------------------------------------------------------------------------

**Guiding principle:** One concept should have one clear meaning across
Meridian. Consistent language is a foundation for coherent product
design, reliable architecture and effective collaboration between people
and AI agents.
