# Rules — How To Code

> Single, abstract, language-agnostic set of principles and constraints all code **must follow**.
> Generated / maintained via `/sys-rules`. This is the source of truth for how code is built.
> Companion to `./rfc.md` (WHAT to build). Where the RFC defines behavior, this file governs construction.

---

## Objective

Build the system as a **semantic input runtime** whose truth lives in an isolated domain core, where every behavior is a composition of small, replaceable parts, and where the machine-facing canonical output is correct, deterministic, and independent of any presentation, state, localization, or environment concern. These rules exist to keep that core pure, the boundaries explicit, and the author-facing surface small enough that a non-expert can use it. They are stable and opinionated; deviation is a defect unless the rule itself is changed first.

---

## 1. Architectural Priorities (ranked)

When two priorities conflict, the higher-ranked one wins.

1. **Canonical correctness above all.** The machine-facing canonical output MUST be correct, standard-conformant, and reproducible. _Why:_ it is the system's reason to exist and the contract consumers depend on. _Prevents:_ silent data corruption and unstandardized output. _Risk if misused:_ trading correctness for convenience produces data that is wrong but looks fine.
2. **Domain isolation.** The domain core MUST NOT depend on any outer concern (presentation, state, localization, transport, environment). _Why:_ purity is what makes correctness and determinism achievable and testable. _Prevents:_ leakage of incidental concerns into truth. _Risk if misused:_ a single inward dependency collapses the whole guarantee.
3. **Determinism.** Identical inputs and explicit context MUST yield identical results everywhere. _Why:_ without it, correctness cannot be verified or trusted. _Prevents:_ environment-dependent surprises and untestable behavior. _Risk if misused:_ hidden ambient reads make defects irreproducible.
4. **Composability over feature growth.** New behavior MUST arrive as a new small part registered through the boundary, not as a special case bolted into existing parts. _Why:_ it keeps the core stable as the system grows. _Prevents:_ combinatorial complexity. _Risk if misused:_ "just one branch" accretes into an unmaintainable core.
5. **Approachable surface.** The author-facing configuration MUST stay minimal and usable by a non-expert, with working defaults. _Why:_ the system's value is compiling complexity away. _Prevents:_ leaking internal complexity to authors. _Risk if misused:_ every new knob erodes the reason the system exists.

---

## 2. Structural Model

- **Core vs external.** The **core** is the type/codec logic, validation, normalization, canonical serialization, and the invariants that hold regardless of stack. Everything else — widgets, state, localization, persistence, transport, framework bindings, and the runtime environment — is **external**.
- **Dependency direction.** Dependencies MUST point **inward only**. External parts MAY depend on the core; the core MUST NOT depend on, name, or import any external part. The application/orchestration layer sits between, may depend on the core, and coordinates external parts.
- **Boundaries as ports.** The core MUST expose its needs as abstract capabilities (ports); external parts MUST attach as interchangeable implementations (adapters). An adapter MUST be replaceable by any compatible adapter without changing the core or the canonical output.
- **Single resolution path.** All behavior for a named entity (type, widget, format, serializer, validator, state plugin) MUST be obtained through one registry/resolution mechanism. Parts MUST NOT reach for one another directly.
- **One primitive, configured.** Distinct behaviors MUST be expressed as configuration and registered parts, never as new top-level primitives.
- **Layer placement of logic.** Value semantics belong to the **type** (core). Field-to-field relationships and multi-field composition belong to the **application layer** (orchestration). Presentation, persistence, text, and environment belong to **adapters**. Logic MUST live in its correct layer and nowhere else.

---

## 3. Design Principles

Each principle states when it applies and the boundary where it MUST NOT be pushed further.

- **Type is a codec.** A type MUST fully own its value's filter, parse, validate, normalize, and serialize behavior, and the inverse needed to reconstruct it. _Applies:_ to every value meaning. _Not when:_ it would require a type to know about another field, a widget, or the environment — that knowledge belongs elsewhere.
- **Canonical always wins.** Where a recognized standard governs a meaning, the canonical form MUST follow it; where representations differ, one fixed normalized form MUST be chosen. _Applies:_ to all output. _Not when:_ it would mutate a value's magnitude or precision to fit a format — formatting MUST stay lossless.
- **Two projections, separate fates.** Human-facing (view) and machine-facing (canonical) representations MUST be derived independently; the view MAY depend on locale and context, the canonical MUST NOT. _Applies:_ to every value. _Not when:_ tempted to let display formatting leak into canonical output.
- **Explicit over ambient.** Everything a computation needs MUST be passed in explicitly, especially environment values (current instant, timezone, locale). _Applies:_ to all core and orchestration logic. _Not when:_ never — ambient reads are forbidden in deterministic paths.
- **Composition over special-casing.** Prefer adding a small, independent, registered part over branching inside an existing one. _Applies:_ to all extension. _Not when:_ the abstraction would exist only to be implemented once and adds indirection without removing duplication.
- **Simplicity over abstraction.** Introduce an abstraction only when it removes real duplication or enforces a real boundary. _Applies:_ always. _Not when:_ the abstraction is speculative or merely "clean."
- **Purity in the core.** Core operations MUST be pure functions of their inputs and explicit context — no side effects, no I/O, no hidden state, no concurrency-dependent results. _Applies:_ to the entire core. _Not when:_ never relaxed; side-effecting or asynchronous work MUST live in adapters/orchestration and surface as explicit state.
- **Fail defined, never undefined.** Every operation MUST yield a defined outcome — including for empty, invalid, missing, and ambiguous input — rather than an undefined or thrown-through result. _Applies:_ everywhere. _Not when:_ never; "it can't happen" is not an excuse to leave behavior undefined.
- **Defaults that work.** Every author-facing setting MUST have a sensible default and be expressible simply. _Applies:_ to the configuration surface. _Not when:_ a default would silently change canonical truth — absence MUST be explicit, never guessed into data.

---

## 4. Required Properties

Code MUST structurally uphold each of these; they are checkable, not aspirational.

- **Determinism.** Same inputs + same explicit context ⇒ same outputs, across runs and environments. Upheld by purity and the explicit-context rule.
- **Isolation / framework independence.** The core compiles, runs, and is tested with no presentation, state, localization, or transport present. Upheld by inward-only dependencies and ports.
- **Modularity.** Each part (type, widget, format, serializer, validator, plugin) is independently definable, replaceable, and removable. Upheld by single-resolution and adapter interchangeability.
- **Composability.** Behaviors combine without modifying existing parts; fields compose into aggregates above the core. Upheld by the composition principle and correct layer placement.
- **Testability.** Every core behavior is verifiable in isolation from a known input + context to a known output, including edge and failure cases. Upheld by purity and defined-outcome rules.
- **Lossless fidelity.** Values that cannot be safely represented natively are carried as exact text; formatting (e.g. fractional scale) only pads or rejects, never rounds. Upheld by the codec and canonical principles.
- **Reversibility.** Loading canonical data, editing, and re-emitting MUST reproduce equivalent canonical output (idempotent round-trip). Upheld by the codec contract.
- **Safety.** All external input is treated as untrusted and bounded; canonical output is safe by construction. Upheld by validation-before-output and bounded evaluation.
- **Stable contracts.** Names, codes, and canonical forms that consumers or localization bind to are stable; changes are versioned and backward-compatible. Upheld by the versioning rule.

---

## 5. Anti-Patterns (rejected)

These are defects regardless of how convenient they seem.

- **Inward leakage.** The core depending on, naming, or importing any presentation, state, localization, transport, framework, vendor, or environment concern.
- **Ambient reads.** Reading current time, timezone, locale, or any environment value implicitly instead of receiving it as explicit context.
- **Logic in the wrong layer.** Validation, normalization, or canonicalization living in widgets, state, or transport; or a type reaching across to another field.
- **Lossy convenience.** Rounding, truncating, or reformatting a value's magnitude/precision in the runtime; coercing empty to null; guessing absent values into data.
- **Display-into-truth.** Letting locale, view formatting, widget choice, or state presence influence the canonical projection.
- **Bypassing the boundary.** Parts referencing each other directly instead of through the single resolution mechanism; hard-coded text instead of dictionary resolution.
- **Primitive proliferation.** Adding new top-level primitives or special-case branches instead of new configured/registered parts.
- **Over-abstraction.** Indirection, patterns, or generalization introduced without removing real duplication or enforcing a real boundary.
- **Hidden state and effects.** Impurity, shared mutable state, or order-dependent behavior in paths that must be deterministic.
- **Undefined behavior.** Throwing through, returning undefined results, or leaving empty/invalid/ambiguous cases unspecified.
- **Surface creep.** Expanding author-facing configuration, or exposing internal/numeric/standards detail, beyond what a non-expert needs.
- **Silent contract drift.** Renaming or changing canonical forms, codes, or bound names without versioning and backward compatibility.

---

## 6. Enforcement

- **What is a violation.** Any code that breaks a MUST in this file, contradicts an invariant or contract in `./rfc.md`, or exhibits a §5 anti-pattern is a defect. The change MUST be fixed — not the test weakened, not the rule quietly bent.
- **Conflicts.** If two priorities or rules conflict, resolve by the §1 ranking. If that does not decide it, treat it as a gap in this file (see below), not a license to improvise.
- **Burden of proof.** New abstractions, new author-facing settings, and any relaxation of purity/isolation MUST be justified against these rules before acceptance. Absent justification, reject.
- **When to change the rules, not the code.** If a rule is genuinely wrong, blocks a correct design, or is silent on a real situation, STOP and revise this file first (re-run `/sys-rules`), keeping it consistent with `./rfc.md`. Only then change code. Code MUST NOT diverge from a rule that is still written down.
- **Sync obligation.** `./rfc.md` (what) and this file (how) MUST stay consistent; a change to one that affects the other MUST update both in the same effort.
