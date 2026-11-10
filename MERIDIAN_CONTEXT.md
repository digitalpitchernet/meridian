Meridian --- Context for Humans and AI Agents
Document ID: MER-CONTEXT-001
Version: 0.1
Status: Working baseline --- pending founder review and repository reconciliation
Product: Meridian
Parent organisation: Digital Pitcher Networks (DPN)
Last updated: 10 November 2026
This document is the orientation layer for anyone contributing to Meridian. It summarises the product's established direction and points to the documents that should govern detailed work. It is not a substitute for module specifications, architecture records or verification of the actual codebase.

1. What Meridian is
Meridian is an independently branded founder operating system: a structured digital workspace intended to help a founder organise and run the essential work of building a business.
It brings together important operating areas---such as projects, tasks, milestones, finances, contacts, decisions, documents and reporting---within one coherent workspace.
Meridian is incubated within Digital Pitcher Networks (DPN) as one independent venture in DPN's portfolio. It is not DPN's flagship by default and does not define DPN's identity or constrain the industries in which DPN may build ventures.
Meridian has its own product identity, product direction, roadmap, architecture, documentation and implementation lifecycle. DPN provides the parent organisational context and may provide shared capabilities where appropriate.
2. Product purpose
Meridian's purpose is to give a founder a dependable place to understand, organise and coordinate the moving parts of their business.
The product should help answer practical operating questions:
What is happening in the business?
What needs attention?
Which projects and commitments are active?
What are the next milestones and deadlines?
What financial position and obligations have been recorded?
Where are important documents, decisions and relationships?
What has changed, and what should happen next?
Meridian should reduce fragmentation and improve operational clarity. It should not create complexity simply to appear comprehensive.
3. Intended initial customer and deployment
The established initial product direction is:
Primary customer: Solo founder.
Deployment model: Self-deployed by the user.
Workspace model: Single workspace.
Product direction: A practical, conventional software product rather than an autonomous agent-first system.
Default appearance: Dark.
Information density: Balanced.
Navigation: Hybrid.
Sidebar: Expanded by default.
Motion: Balanced and purposeful.
Branding: Adaptive.
These are product decisions, not claims about what the current codebase already implements. Verify the actual interface and behaviour before reporting implementation status.
4. Product philosophy
Meridian should feel like a dependable operating companion: observant, composed, discreet, useful and trustworthy.
The product philosophy draws inspiration from the qualities of an excellent trusted steward---reliability, anticipation, judgement, discretion and calm execution. This is a design and behavioural reference, not a character or brand identity to reproduce.
Principles
Clarity before complexity --- Present the information needed to act without overwhelming the user.
Dependability --- Prefer predictable, understandable behaviour over novelty.
Discretion and trust --- Treat business information and connected data carefully; make permissions and data flows understandable.
Useful anticipation --- Surface relevant context, deadlines and relationships without pretending to make decisions for the founder.
Coherence --- Modules should feel like parts of one operating environment, not disconnected mini-applications.
User agency --- Keep the founder in control of important decisions and consequential actions.
Practical integration --- Reuse reliable tools and services where sensible instead of rebuilding everything.
Evidence-led expansion --- Add complexity only when a demonstrated user need justifies it.
5. Established V1 product baseline
The following areas form the remembered V1 product baseline. Their presence here means they are part of the approved product direction; it does not mean they have been verified as implemented.

Area                                Intended responsibility

Command Centre / Home               Give the founder a useful overview of current activity, priorities and signals. The final naming and exact composition should follow the latest approved screen specification.
Projects                            Organise business initiatives, workstreams, outcomes and project context.
Tasks                               Track actionable work, ownership where applicable, status and due dates.
Calendar & Milestones               Present relevant dates, milestones and commitments.
Finances                            Record and review financial information, with initial financial entry through import.
Contacts                            Maintain useful records of people and business relationships.
Decisions                           Preserve important decisions and their context.
Vault / Documents                   Store and organise important business documents.
Reports                             Present useful summaries and operational visibility.
Settings                            Manage product preferences and workspace configuration.
The exact boundaries, data models, interactions and acceptance criteria for each module must be defined in their individual specifications and reconciled with the existing implementation.
6. Established product and architecture decisions
The following decisions were made during product planning. They must be checked against the current repository before being treated as facts about the implementation.
Decision area         Established direction

Workspace             Single workspace Document storage      Both local and Supabase-backed storage Financial entry       Import-first Frontend approach     Vanilla frontend Initial user          Solo founder Deployment            Self-deployed Default appearance    Dark Information density   Balanced Branding              Adaptive Navigation            Hybrid Motion                Balanced
Integrations and personalisation
The planned personalisation experience may allow the user to connect:
Google Calendar
Gmail
Google Drive
The intended purpose is to bring relevant calendar, communication and document context into the founder's workspace. The exact scopes, OAuth implementation, permissions, sync behaviour, data retention, failure handling and security requirements must be specified and verified before implementation is considered complete.
Google connections are not permission to ingest or expose all account data indiscriminately. Request only the scopes required for clearly defined product features and explain the resulting data use to the user.
Architecture caution
Do not infer or invent the current:
Framework, build system or runtime.
Database schema or data model.
Authentication and authorisation design.
Supabase project configuration.
Storage implementation.
API routes, edge functions or server-side services.
Deployment platform or environment configuration.
Integration status.
Inspect the actual repository and relevant project configuration before documenting these as implementation facts.
7. Scope boundaries and deferred capabilities
The initial product should remain focused. The following are outside the established V1 baseline unless the founder explicitly approves a change:
Multi-workspace or multi-tenant operation.
Full team collaboration and complex role management.
Autonomous AI agents or an agent marketplace.
Full CRM replacement.
Direct banking and accounting integrations.
Native mobile applications.
Broad automation systems.
Industry-specific operational modules as mandatory core functionality.
Some of these may become valuable later. They should be evaluated through deliberate product decisions, not added by assumption.
The name Jared has been reserved as a possible name for a future AI agent within Meridian. This is a naming reservation only; it is not approval to build an agent or include agent functionality in V1.
8. Industry adaptability
Meridian's core should provide general-purpose operating capabilities that can support different kinds of founders and businesses.
Potential industry-specific extensions have been explored, including:
Small-scale distilleries: production and batch records, raw-material and finished-goods inventory, suppliers and procurement, costing, sales and distribution, compliance records and reminders.
Creative and development agencies / freelancers: client and project management, delivery planning, tasks and timelines, effort tracking, proposals and quotations, budgets and profitability, retainers, payments, approvals and feedback.
These are exploratory industry opportunities, not confirmed V1 requirements. Keep general-purpose core modules separate from optional industry packs. Do not hardwire an industry-specific workflow into the core without an explicit product decision.
9. Relationship with DPN
DPN is the parent venture-building organisation. Meridian is an independently branded, DPN-incubated venture.
DPN's established default is to own and operate ventures it creates, subject to applicable law and properly documented agreements. This is an organisational policy, not proof of legal title or a substitute for legal agreements.
Meridian's product decisions should remain consistent with DPN's Strategic Charter while preserving Meridian's independent product identity and roadmap.
For DPN-level context, consult the DPN documentation repository, particularly the Strategic Charter and Venture Registry. Do not copy the entire DPN portfolio into Meridian's product documentation.
10. Documentation map
The following is the intended documentation architecture. It is a proposed structure until reconciled with the actual Meridian repository.
MERIDIAN/
├── MERIDIAN_CONTEXT.md
└── docs/
    ├── 00-foundation/
    │   ├── MERIDIAN-CHARTER.md
    │   ├── PRODUCT-PRINCIPLES.md
    │   ├── PRODUCT-ROADMAP.md
    │   └── CANONICAL-LEXICON.md
    ├── 01-architecture/
    │   ├── SYSTEM-ARCHITECTURE.md
    │   ├── MODULE-ARCHITECTURE.md
    │   ├── DATA-ARCHITECTURE.md
    │   └── INTEGRATION-ARCHITECTURE.md
    ├── 02-modules/
    │   └── MODULE-REGISTRY.md
    ├── 03-industry-packs/
    ├── 04-decisions/
    ├── 05-implementation/
    │   ├── CURRENT-STATE.md
    │   ├── IMPLEMENTATION-STATUS.md
    │   ├── KNOWN-ISSUES.md
    │   └── HANDOFF-PROTOCOL.md
    └── 06-handoffs/
Do not create every file simply because it appears in this proposed map. Create and maintain documents when there is enough verified information and a real need for them.
11. Documentation status vocabulary
Use these labels consistently:
LOCKED --- Explicitly approved decision. Change only through a deliberate decision.
PROPOSED --- Recommendation awaiting approval.
OPEN --- Unresolved question requiring a decision.
DEFERRED --- Deliberately postponed; not part of current execution.
VERIFIED --- Confirmed against the actual repository or running product.
PARTIAL --- Some of the specified capability exists, but acceptance criteria are not fully met.
NOT IMPLEMENTED --- Checked and confirmed absent.
UNVERIFIED --- Implementation status has not yet been checked.
Do not use VERIFIED, PARTIAL or NOT IMPLEMENTED based solely on a previous conversation, a prompt, a design mock-up or an intended implementation.
12. Instructions for AI agents and contributors
Before making changes to Meridian:
Read this context document.
Read the relevant current product charter, module specification and decision records.
Inspect the actual repository and identify the current implementation before proposing changes.
Separate approved requirements from suggestions and assumptions.
Preserve existing behaviour unless the approved scope explicitly changes it.
Avoid broad rewrites or architectural changes without an explicit decision.
Do not introduce new dependencies, services, integrations or paid infrastructure without explaining the need and trade-offs.
Protect credentials, secrets, personal information and connected-account data. Never commit secrets to the repository.
Define acceptance criteria and relevant tests before substantial implementation.
After implementation, report what changed, what was tested, what remains incomplete and any risks.
Reconcile documentation with the delivered and verified state.
Flag contradictions or missing decisions instead of silently inventing answers.
Implementation handoff minimum
A substantial implementation task should include:
Objective and user problem.
Relevant approved product decisions.
Scope and explicit non-goals.
Existing implementation state.
Relevant module and architecture specifications.
Acceptance criteria.
Testing and verification requirements.
Documentation that must be updated.
A short prompt is not a substitute for the context and specifications required to implement safely.
13. Immediate next steps
This context document is the starting point, not the completion of Meridian's documentation.
The intended sequence is:
Review and approve this context baseline.
Create the Meridian Product Charter.
Create Product Principles and the initial Roadmap.
Establish the Canonical Lexicon and Module Registry.
Inspect the actual GitHub repository and reconcile all remembered decisions with the current code.
Produce architecture and implementation documentation only from verified evidence.
Resume module-by-module planning and development.
14. Open verification items
The following must remain explicitly unverified until the codebase is inspected:
Current framework and exact technology versions.
Current repository structure and branch state.
Existing modules and their completion status.
Current database schema and Supabase integration.
Local and remote document-storage behaviour.
Authentication, authorisation and security model.
Google integration implementation and OAuth scopes.
Deployment and environment configuration.
Existing tests, test coverage and known defects.
Differences between the current build and the approved V1 product baseline.

Guiding principle: Meridian's documentation must describe the product we have deliberately decided to build while remaining honest about what has actually been built. Product intent, approved decisions and verified implementation are related---but they are never interchangeable.
