# Meridian --- Product Principles

**Document ID:** MER-PRIN-001\
**Version:** 0.1\
**Status:** Working baseline --- pending founder review\
**Product:** Meridian\
**Parent organisation:** Digital Pitcher Networks (DPN)\
**Created:** 10 November 2026

> This document translates Meridian's Product Charter into practical
> principles for product design, user experience, engineering, data,
> integrations and future capabilities. It guides decisions; it does not
> replace detailed specifications or verify the current implementation.

------------------------------------------------------------------------

## 1. Purpose

Meridian's Product Charter defines what the product is and why it
exists. This document explains how Meridian should be conceived,
designed and developed.

Use these principles when:

-   Evaluating a proposed feature.
-   Designing a screen or workflow.
-   Deciding whether to build, integrate, extend or defer a capability.
-   Choosing how modules share information.
-   Handling user data and external connections.
-   Reviewing the quality of an implementation.
-   Resolving trade-offs between convenience, complexity, reliability
    and control.

When a proposal conflicts with an established principle, make the
conflict explicit and seek a deliberate decision. Do not silently ignore
the principle or invent an exception.

## 2. The central product test

Every meaningful product decision should help Meridian deliver on this
promise:

**Give a founder a clearer, more dependable way to organise and operate
their business, without adding unnecessary complexity or taking away
their control.**

A feature should be evaluated against four questions:

1.  Does it solve a real founder problem?
2.  Does it make the operating picture clearer or the work easier?
3.  Can it be delivered and maintained reliably?
4.  Does its value justify the complexity, cost, risk and ongoing
    responsibility it introduces?

A feature that cannot answer these questions convincingly should be
reconsidered, simplified or deferred.

## 3. Product and experience principles

### 3.1 Clarity before density

Present the information needed to understand a situation and take the
next useful action.

-   Give important information a clear hierarchy.
-   Avoid presenting every available data point at once.
-   Use progressive disclosure for secondary detail and advanced
    controls.
-   Make empty, loading, error and success states understandable.
-   Do not confuse visual sophistication with information clarity.

**Decision test:** Can the founder understand what matters without
having to decode the interface?

### 3.2 Useful overview, not dashboard theatre

The Command Centre / Home experience should help the founder understand
the state of the business and identify what deserves attention.

-   Prioritise actionable information over decorative metrics.
-   Show the source and freshness of important information where
    relevant.
-   Avoid arbitrary scores, vanity metrics and unsupported health
    indicators.
-   Make summaries traceable to the underlying records.
-   Do not surface an alert unless it is meaningful and, where possible,
    actionable.

**Decision test:** Does this overview help the founder decide what to
inspect or do next?

### 3.3 Coherence across modules

Meridian should feel like one operating environment rather than a
collection of unrelated mini-applications.

-   Use consistent interaction patterns, terminology and visual
    hierarchy.
-   Make relationships between modules understandable.
-   Avoid duplicate records where a shared source of truth is
    appropriate.
-   Keep module responsibilities clear.
-   Ensure navigation and cross-module movement feel predictable.

**Decision test:** Does this feature strengthen the whole product, or
create an isolated experience?

### 3.4 Progressive capability

Start with a useful, understandable core and introduce advanced
capability only when it earns its place.

-   Keep common workflows straightforward.
-   Make advanced options discoverable without forcing them into every
    workflow.
-   Prefer a small number of complete, reliable capabilities over many
    incomplete ones.
-   Avoid premature abstraction and speculative extensibility.
-   Add configuration only when users need meaningful control.

**Decision test:** Is this complexity necessary now, or are we building
for a hypothetical future?

### 3.5 Calm and purposeful interaction

Meridian should feel composed, responsive and deliberate.

-   Use motion to communicate state, continuity or hierarchy---not as
    decoration.
-   Keep transitions consistent and proportionate.
-   Avoid unnecessary interruptions, pop-ups and attention-seeking
    notifications.
-   Provide clear feedback after user actions.
-   Respect reduced-motion preferences where applicable.

**Decision test:** Does this interaction help the user understand what
happened, or merely attract attention?

### 3.6 User agency and reversibility

The founder remains in control of their workspace and consequential
actions.

-   Explain what an action will do before it has significant
    consequences.
-   Ask for confirmation when an action is destructive, external or
    difficult to reverse.
-   Provide undo or recovery paths where practical.
-   Do not silently change important records or settings.
-   Make automation opt-in and appropriately bounded.

**Decision test:** Does the user understand and control the action and
its consequences?

### 3.7 Dependability over novelty

Prefer reliable, maintainable behaviour over fashionable technology or
unnecessary technical sophistication.

-   Choose established approaches when they meet the requirement.
-   Avoid dependencies without a clear purpose.
-   Consider maintenance, security, portability and operational cost.
-   Design for graceful failure and recovery.
-   Do not introduce infrastructure or services simply because they are
    available.

**Decision test:** Can the team explain why this approach is dependable
and sustainable?

## 4. Information and data principles

### 4.1 Clear source of truth

Each important piece of information should have a clear authoritative
record.

-   Avoid multiple competing versions of the same business record.
-   Define which module owns a record and which modules reference it.
-   Where information is imported or synchronised, identify its origin.
-   Distinguish user-entered, imported, calculated and suggested
    information.
-   Avoid silently overwriting user data with external data.

### 4.2 Context and traceability

Important information should retain enough context to be understood
later.

-   Preserve relevant dates, relationships and provenance.
-   Make significant decisions and their rationale discoverable.
-   Keep references between related projects, tasks, contacts, documents
    and financial records where useful.
-   Avoid storing unexplained values that cannot be interpreted.
-   Make changes to important records understandable where auditability
    is required.

### 4.3 Honest representation

Meridian must not imply that information is more complete or certain
than it is.

-   Distinguish actuals from estimates and projections.
-   Identify stale, missing or incomplete data where it affects
    interpretation.
-   Do not present a failed sync as a successful update.
-   Do not fabricate metrics or infer facts without a defensible basis.
-   Make calculation assumptions visible when they materially affect a
    result.

### 4.4 Data minimisation

Collect and retain only information required for a defined product
purpose.

-   Avoid collecting data simply because an integration makes it
    accessible.
-   Limit access to the information needed by each feature.
-   Define retention and deletion behaviour deliberately.
-   Keep secrets and credentials out of source code and documentation.
-   Treat connected-account data with care and make its use
    understandable.

## 5. Integration principles

Meridian should not rebuild a mature external capability unless doing so
provides a clear product advantage.

Evaluate each integration using:

-   User value and workflow fit.
-   API availability and documented capabilities.
-   Reliability, rate limits and service dependencies.
-   Authentication and permission requirements.
-   Data ownership, synchronisation and conflict behaviour.
-   Cost, free-tier restrictions and likely future pricing.
-   Vendor lock-in and exit options.
-   Maintenance burden and failure recovery.

### Integration rules

1.  Prefer narrow, purpose-specific permissions.
2.  Explain why an external account is being connected.
3.  Do not assume access to all data in a connected account.
4.  Handle expired credentials, revoked permissions, rate limits and
    outages.
5.  Make sync status and relevant failures visible.
6.  Avoid destructive synchronisation or silent conflict resolution.
7.  Preserve a usable experience when an external service is temporarily
    unavailable, where feasible.
8.  Document the integration's data flow and operational dependencies.

Google Calendar, Gmail and Google Drive are planned connection areas.
Their exact scopes, workflows and implementation must be specified and
verified separately.

## 6. Security, privacy and trust

Trust is a product requirement, not a final polish task.

-   Use least-privilege access.
-   Protect credentials and sensitive data.
-   Do not expose one user's information to another.
-   Validate and authorise operations at the appropriate boundary.
-   Use secure storage and transport practices appropriate to the
    architecture.
-   Avoid logging secrets or unnecessary sensitive content.
-   Make permissions, connected services and data handling
    understandable.
-   Consider backup, export, recovery and deletion as part of data
    lifecycle design.

Specific security controls must be documented in the architecture and
implementation records after inspection of the actual system. This
principles document is not a security audit or certification.

## 7. AI and automation principles

Meridian's established initial direction is a practical, conventional
software product---not an autonomous agent-first system.

Future AI or automation features should follow these principles:

-   Begin with a clearly defined user problem.
-   Provide assistance that is understandable and appropriately bounded.
-   Distinguish generated suggestions from verified business records.
-   Show relevant sources or context for consequential recommendations.
-   Require user approval for consequential external actions unless a
    separately approved, narrowly scoped permission model exists.
-   Provide clear controls to review, disable or revoke automation.
-   Do not create autonomous behaviour merely to make the product appear
    more advanced.

The possible future agent name **Jared** is a reserved naming idea, not
an approved feature or implementation requirement.

## 8. Visual and interaction baseline

The following experience decisions have been established during product
planning and should guide design work, subject to reconciliation with
the latest approved screen specifications:

  Area                  Established direction
  --------------------- -----------------------
  Default appearance    Dark
  Information density   Balanced
  Branding              Adaptive
  Navigation            Hybrid
  Sidebar               Expanded by default
  Motion                Balanced
  Command Centre        Hybrid approach

Apply these directions consistently, but do not interpret them as
permission to invent unspecified screen layouts or interactions.
Detailed screen specifications and the actual implementation remain the
source for those details.

### Accessibility and usability

-   Maintain readable contrast and typography.
-   Support keyboard navigation where applicable.
-   Use clear labels and meaningful focus states.
-   Do not rely on colour alone to communicate status.
-   Make controls and feedback understandable.
-   Consider small screens and responsive behaviour even if the initial
    deployment is desktop-oriented.

## 9. Engineering and implementation principles

### 9.1 Inspect before changing

Before implementing a feature or modifying architecture:

-   Inspect the relevant existing code.
-   Identify current patterns, dependencies and constraints.
-   Check whether a similar capability already exists.
-   Understand data and module dependencies.
-   Confirm the intended scope and acceptance criteria.

Do not assume the repository matches an earlier prompt or design.

### 9.2 Small, reviewable changes

-   Prefer changes that are scoped and understandable.
-   Avoid broad rewrites without an explicit decision.
-   Preserve working behaviour unless the requirement intentionally
    changes it.
-   Keep code and module responsibilities clear.
-   Explain material dependency or architecture changes.

### 9.3 Test what matters

-   Define acceptance criteria before substantial implementation.
-   Test normal, empty, invalid, error and recovery states where
    relevant.
-   Verify permissions and data boundaries for sensitive operations.
-   Test integrations under failure conditions where feasible.
-   Do not claim a feature is complete based only on successful
    rendering or a happy-path demonstration.

### 9.4 Documentation follows reality

-   Record approved decisions and their rationale.
-   Keep specifications aligned with approved scope.
-   After implementation, update status based on what was actually
    delivered and tested.
-   Mark uncertain states as unverified.
-   Do not convert implementation intentions into claims of completion.

## 10. Feature evaluation framework

Before accepting a new feature into the product, assess it against the
following:

  -----------------------------------------------------------------------
  Dimension                           Question
  ----------------------------------- -----------------------------------
  Problem                             What real founder problem does it
                                      solve?

  User                                Who needs it, and in what context?

  Value                               What becomes easier, clearer or
                                      more reliable?

  Fit                                 Does it belong in Meridian's core,
                                      an optional industry pack or an
                                      external tool?

  Alternatives                        Can an existing tool or integration
                                      solve it better?

  Complexity                          What new interface, data, workflow
                                      and maintenance burden does it add?

  Dependencies                        Does it rely on external services,
                                      APIs or paid infrastructure?

  Risk                                What are the privacy, security,
                                      reliability and operational
                                      implications?

  Evidence                            What validates the need and
                                      proposed approach?

  Timing                              Is it necessary now, or should it
                                      be deferred?
  -----------------------------------------------------------------------

A feature may be classified as:

-   **Build natively** --- A core capability central to Meridian's
    product experience or data model.
-   **Integrate** --- A mature external capability is better consumed
    through a reliable integration.
-   **Extend** --- Improve an existing Meridian capability.
-   **Package** --- Provide as an optional industry-specific extension.
-   **Defer** --- Potentially valuable, but not justified for the
    current stage.
-   **Reject** --- Does not fit the product's purpose or has
    insufficient value.

## 11. Non-negotiable decision discipline

-   An idea is not an approved requirement.
-   A mock-up is not a working feature.
-   A prompt is not proof of implementation.
-   A successful happy path is not proof of reliability.
-   An integration concept is not a connected service.
-   A planned capability is not a current capability.
-   A documented decision is not proof that the codebase follows it.

When evidence is missing, record the state as `UNVERIFIED` and
investigate.

## 12. Review and amendment

These principles should remain stable enough to guide consistent
decisions but may evolve as Meridian is tested and used.

A proposed amendment should state:

-   Which principle is changing.
-   Why the existing principle is insufficient.
-   What product, user or engineering consequences follow.
-   Whether the change affects existing modules or commitments.
-   Which related documents require revision.

Material changes require founder approval and should be reflected in the
Product Charter or relevant decision records where appropriate.

## 13. Current approval state

Version 0.1 is a working baseline pending founder review. It should not
be labelled `LOCKED` until explicitly approved.

------------------------------------------------------------------------

**Guiding principle:** Meridian should earn trust through clarity,
coherence, control and dependable execution. Every feature, design
choice and technical decision should strengthen that promise.
