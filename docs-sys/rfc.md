# RFC — Semantic Input Runtime

> Single, abstract, language-agnostic specification of **what** this system is and must do.
> Generated / maintained via `/sys-plan`. This is the source of truth for scope and behavior.

---

## Abstract

This system is a **semantic runtime for human input**. It treats a unit of input not as a visual widget but as a compiler that transforms a raw human-entered string into canonical, standardized, machine-safe data. The system exposes a **single input primitive**; all behavior is selected by configuration and inference rather than by composing many distinct components. Every input value is held in **two simultaneous projections** — a human-facing view and a machine-facing canonical form — and the canonical form MUST conform to recognized global standards whenever one applies. The architecture is layered (domain core, application orchestration, adapters) so that presentation, state, and localization are interchangeable and never influence domain truth.

---

## Terminology

- **Field** — one runtime instance of the input primitive: the smallest unit that compiles one human input into canonical data.
- **Type** — a semantic descriptor that fully defines how a field is filtered, parsed, validated, normalized, and serialized. A type is a codec, not a label.
- **Use** — the intended interaction style of a field (how the human interacts), independent of its type.
- **Widget** — a purely presentational adapter that renders a field's current value and state and emits human input. It holds no domain logic.
- **Raw** — the unprocessed string exactly as entered by the human.
- **View projection** — the human-readable representation of a value, locale- and context-sensitive.
- **Canonical projection** — the standardized, machine-safe representation intended for downstream consumers.
- **Pipeline** — the ordered transformation a raw input passes through to become canonical data.
- **Registry** — the central lookup that resolves names (types, widgets, formats, serializers, validators) to their definitions.
- **State plugin** — an optional external adapter that owns and observes field value/state.
- **Locale** — an identifier selecting a language/region variant for resolving user-facing text.
- **Dictionary** — a flat key-to-text mapping used to resolve all user-facing text.
- **Consumer** — any downstream actor that receives canonical output (e.g. a service interface, persistence, export).
- **Aggregate (virtual-form)** — an application-layer grouping of fields that produces one combined canonical record and one combined validity. It is not itself a field and holds no domain logic of its own.
- **Context** — the explicit, caller-supplied environment a compilation runs against (e.g. current instant, active timezone, active locale). Context is always passed in, never read ambiently.
- **Warning** — a non-blocking advisory about a value that is nonetheless valid; distinct from an **error**, which makes the value invalid and suppresses canonical output.
- **Dependency** — a declared relationship in which one field's validity, requiredness, or visibility is a function of one or more other fields' values, evaluated above the domain core.

Requirement keywords **MUST**, **MUST NOT**, **SHOULD**, **MAY** are used in their normative sense.

---

## 1. Purpose & Scope

### 1.1 Problem

Human input arrives as ambiguous, locale-specific, free-form text, while downstream consumers require standardized, validated, machine-safe data. This system MUST compile the former into the latter as an intrinsic property of each field's declared meaning.

### 1.2 In scope

- A single configurable input primitive that compiles one human input into canonical data.
- A canonical type system aligned to recognized global standards.
- A deterministic transformation pipeline (filter → parse → validate → normalize → serialize).
- Dual projection (view and canonical) for every value, with a specialized projection for time.
- A registry resolving types, presentation adapters, formats, serializers, and validators.
- Convention-driven inference of type, interaction style, and user-facing text when metadata is absent.
- A flat-key localization layer for all user-facing text.
- An optional, pluggable external state layer.

### 1.3 Out of scope

- Any specific presentation technology, state technology, or transport mechanism (these are interchangeable adapters).
- Layout, theming, and visual design beyond the abstract widget contract.
- Server-side business logic beyond producing canonical output.
- Authentication, authorization, and persistence policy of consumers.

### 1.4 Actors

- **Human** — enters and edits input through a widget.
- **Author** — declares fields via configuration (or relies on inference).
- **Consumer** — receives canonical output.
- **Extension provider** — registers additional types, widgets, formats, serializers, validators, or a state plugin.

---

## 2. Capabilities (Functional Requirements)

### 2.1 Single primitive

The system MUST expose exactly one input primitive. All distinct behaviors MUST be selected through configuration and inference, not through a proliferation of primitives. Authors MUST be able to declare a working field using only a small set of high-level knobs (intended interaction style, semantic type, default value, bounds, allowed choices, and whether input is required); everything else MUST be inferred or defaulted.

### 2.2 Compilation pipeline

On each input change, the system MUST process the raw string through an ordered pipeline: **filter → (optional fast-path pattern check) → parse → validate → normalize → serialize**. Each stage MUST be defined by the field's type. The pipeline MUST be deterministic: identical raw input, type, locale, and context MUST yield identical projections.

- Filtering MUST be able to reject or strip disallowed characters before parsing.
- Parsing MUST convert the filtered string into the type's internal value or report a parse failure.
- Validation MUST decide whether the parsed value satisfies the type's semantic rules and any author-declared constraints.
- Normalization MUST convert a valid value into its standardized internal form.
- Serialization MUST produce the canonical projection from the normalized value.

**Locale-aware input, locale-independent output.** Filtering and parsing MAY consult locale and context to _interpret_ raw human input (e.g. decimal separators, date orderings). The parsed internal value, the normalized form, and the canonical projection MUST be locale-independent: the same human intent entered under different input locales MUST yield the same canonical output. An author MAY override locale interpretation per field with a simple flag (e.g. force plain dot-decimal numeric input regardless of locale); such a flag affects input interpretation only, never the canonical output contract.

**Explicit context, never ambient.** All environment-dependent inputs a stage needs — current instant, active timezone, active locale — MUST be supplied as explicit context. No stage may read them implicitly from the ambient environment. This is what makes the determinism guarantee (§5) enforceable and testable.

### 2.3 Dual projection

Every field value MUST simultaneously expose: the raw string, a view projection, a canonical projection, and a validity indicator. The view projection MUST be derived for human reading; the canonical projection MUST be derived for machine consumption. Consumers MUST receive only the canonical projection.

### 2.4 Canonical conformance

When a recognized global standard exists for a value's meaning, the canonical projection MUST conform to that standard. Examples of governed meanings include date/time, unique identifiers, network addresses, web addresses, telephone numbers, country, language, currency, and duration. Where multiple representations are permitted by a standard, the system MUST choose one fixed normalized form and apply it consistently. When more than one global standard could govern a meaning, the system MUST select the **most specific applicable** standard; ties MUST be broken by a fixed, declared priority order recorded per meaning, never decided arbitrarily.

### 2.5 Time as dual projection

Any time-bearing field MUST maintain at least: a local human-facing representation, a canonical absolute representation in a universal reference frame, and an absolute numeric instant. The widget MUST display the local representation; consumers MUST receive the universal-reference-frame representation. Conversion between them MUST be lossless with respect to the represented instant.

**Zoneless temporal values.** A **calendar date** and a **time of day** are explicitly zoneless: they denote a wall-clock position, not a point on the absolute timeline, and a timezone MUST NOT be attached to them. For such values the canonical projection is the zoneless ISO form (date → `YYYY-MM-DD`; time-of-day → `HH:MM:SS`), never an absolute instant — attaching a fixed reference date or offset would bake in a spurious, DST-dependent interpretation. The §2.5 "absolute numeric instant" requirement is satisfied for zoneless values by a **derived projection** anchored to a fixed reference (date → epoch at UTC midnight; time-of-day → milliseconds-of-day), which is a convenience projection only and MUST NOT be treated as canonical truth. A time that must denote an absolute instant MUST be modeled as a date-time, or as a zoneless time paired with an explicit timezone field combined downstream.

### 2.6 Numeric fidelity (string-encoded numbers)

The runtime MUST NOT perform precision-sensitive numeric arithmetic, rounding, or reformatting of magnitude. For any value whose exact magnitude or precision cannot be preserved by the host's native numeric representation — including arbitrary-precision decimals and integers or fractional numbers outside the host's safe numeric range — both the internal value and the canonical projection MUST be carried as a textual representation, never as a native number. For such types, validation MUST only confirm that the textual value is a well-formed instance of the type (correct sign, digits, separators, and form); it MUST NOT alter the represented magnitude or precision. Precision and rounding policy is the responsibility of the consumer, not this system. The view projection MAY format such a value for display, but the canonical projection MUST preserve the entered magnitude exactly as a string.

**Fractional scale (configurable).** An author MAY declare, with a single simple setting, a fixed number of fractional digits (a _scale_) for a numeric value — e.g. choosing a two-digit fraction so `0.5` appears as `0.50`, or a one-digit fraction so it appears as `0.5`. The scale governs textual **form only** and MUST be applied without precision arithmetic:

- A value with **fewer** fractional digits than the scale MUST be padded with trailing zeros up to the scale (a lossless operation).
- A value with **more** fractional digits than the scale MUST be treated as a validation failure, never silently rounded; the input stage MAY additionally prevent entry of digits beyond the scale.
- When **no** scale is declared, the value MUST be preserved exactly as entered.

The author MAY apply the scale to the view projection, the canonical projection, or both. Trailing-zero presence and fraction width in the canonical string are therefore author-determined by the scale; in its absence the canonical string preserves the entered form. The scale setting MUST be expressible by a non-technical author (a single count or simple pattern), consistent with §5's minimal, approachable surface.

### 2.7 Validation and field state

Each field MUST track observable state including at least: validity, whether it has been modified from its initial value, whether it has been interacted with, and any current errors and warnings. State transitions MUST be a function of the pipeline outcome and interaction history, not of the presentation layer.

**Errors vs warnings.** An **error** makes the field invalid and MUST suppress canonical output. A **warning** is a non-blocking advisory: the field remains valid and MUST still emit its canonical projection. Both are surfaced; only errors gate output.

### 2.8 Constraints

The system MUST support author-declared constraints including bounds (lower/upper limit and increment), fractional scale (§2.6) for numeric values, required-ness, default value, a semantic or pattern matcher, and editability flags (disabled, read-only, hidden). For collection-valued fields, the system MUST support multiplicity, uniqueness, and item-count bounds. Bounds declared abstractly MUST apply consistently whether they constrain a scalar magnitude or a collection size; the **resolved type** decides which interpretation applies (collection-valued → item-count, otherwise → magnitude), so the meaning is never ambiguous once the type is resolved.

**Default-value semantics.** A declared default seeds the field's initial value through the **same pipeline** as human input and is expressed in author terms. A field carrying only its default MUST start **not-modified and not-interacted-with**; it becomes modified only when a human edits it. A default MUST itself satisfy the field's constraints.

### 2.9 Choices / collections

The system MUST support fields whose values are selected from a declared set of choices and fields whose values are collections. Collection behavior MUST honor multiplicity, uniqueness, and minimum/maximum item counts.

### 2.10 Widget rendering

Widgets MUST render purely from a field's value, state, and context, and MUST emit raw human input back to the field. Widgets MUST NOT filter, parse, validate, normalize, mutate domain logic, or hold canonical truth. A field's type and canonical output MUST be unaffected by which widget renders it.

### 2.11 Registry

The system MUST provide a central registry that resolves names to definitions across at least these categories: types, widgets, formats, serializers, and validators. Resolution MUST be the single mechanism by which the runtime obtains behavior for a named entity.

### 2.12 Inference (convention over configuration)

When metadata is absent, the system MUST infer sensible defaults:

- **Type inference** from a field's name or shape (e.g. a name connoting an address resolves to the corresponding semantic type; a name connoting a count resolves to an integer type; a name connoting a moment resolves to a time type).
- **Interaction-style inference** from the resolved type (e.g. a numeric type implies numeric entry; a time type implies a temporal selector; a boolean type implies a two-state control).
- **User-facing-text inference** from a field's name (e.g. a machine name is humanized into a default label).

Explicit author configuration MUST always override inference.

### 2.13 Localization

All user-facing text MUST be resolved through a flat-key dictionary; text MUST NOT be hardcoded in widgets. The system MUST support at least these text categories: label, help text, error message, and validation message. Resolution MUST follow a deterministic fallback chain: exact key for the requested locale → a default locale → a generic key. The localization layer is a runtime projection and MUST NOT influence domain logic or canonical output.

**Stable error/validation codes.** Each type MUST declare a stable, enumerable set of error and validation codes. These codes ARE the contract that dictionary keys bind to (e.g. an `error.<code>` key resolves text for a specific code). Codes MUST be stable across releases; renaming or removing a code is a breaking change.

### 2.14 External state (optional)

The system MUST function without any external state layer. When an external state plugin is present, it MUST be able to create, set, and observe a field's value/state. The state layer MUST NEVER influence domain logic or canonical output; it MUST be fully removable without changing compilation results.

### 2.15 Extensibility

The system MUST allow extension providers to register additional types, widgets, formats, serializers, and validators, and to supply a state plugin, all through the registry without modifying the domain core.

### 2.16 Cross-field dependencies

The system MUST support declared **dependencies** in which one field's validity, requiredness, or visibility is a function of other fields' values (e.g. an upper bound that must exceed a lower-bound field, a confirmation that must match, a field required only when another holds a given value). Dependencies MUST be evaluated in the **application/orchestration layer**, above the domain core. The domain core and an individual type MUST remain self-contained: a type MUST NOT reference any other field. Dependency evaluation MUST be deterministic and MUST NOT alter any field's canonical projection — it MAY only affect validity, requiredness, and visibility.

### 2.17 Aggregate (virtual-form)

The system MUST support composing multiple fields into an **aggregate** (a virtual-form) that yields one combined canonical record and one combined validity. The aggregate MUST collect each member field's canonical projection keyed by that field's name; per §2.16 it MAY additionally apply cross-field dependencies. The aggregate is valid only when all required member fields are valid, and MUST emit its combined canonical record only when valid. The aggregate is an application-layer construct: it is not a field, holds no domain logic, and MUST NOT change how any member field compiles its own value.

### 2.18 Untrusted input

The system MUST treat all raw input as untrusted. It MUST enforce a bounded maximum raw input length, MUST ensure any fast-path pattern is evaluable in bounded time (no catastrophic backtracking), and MUST NOT execute, interpret, or interpolate raw input. Canonical output MUST be safe by construction.

---

## 3. Contracts (Abstract Interfaces)

### 3.1 Type contract

A type MUST define the full pipeline for its values: filter, parse, validate, normalize, and serialize, and SHOULD define the inverse needed to reconstruct an internal value from canonical input (deserialize). A type MAY declare a fast-path pattern used to short-circuit obviously invalid input before parsing. A type is the sole authority over its value's semantics. A type's round-trip MUST be idempotent: for any valid canonical value, serializing the result of deserializing it MUST reproduce the original canonical value exactly (the load-edit-resave guarantee).

### 3.2 Field contract

A field MUST expose stable identity and metadata, its resolved type and interaction style, its current value in all required projections, and its observable state. Inputs to a field are the raw human string and author configuration; outputs are the projections and state. Invalid input MUST still yield a defined field state (invalid, with errors) rather than an undefined or thrown result.

### 3.3 Value contract

A value MUST always present: raw, view, canonical, and validity. A time-bearing value MUST additionally present local, universal-reference-frame, and absolute-instant projections. The canonical projection of any value whose magnitude or precision cannot be safely represented natively (arbitrary-precision decimals/integers and out-of-safe-range fractional numbers) MUST be a textual representation that preserves the entered value exactly. A value MAY present a diagnostic projection for debugging that exposes stage-by-stage intermediates (raw → filtered → parsed → normalized) and timing; it MUST be off by default in non-debug contexts and MUST NOT be consumed as canonical truth.

**Absent vs null vs empty.** Empty input MUST NOT be silently coerced to null. A required field that is empty is invalid (§4.1). For an optional empty field the canonical record MUST **omit** the key by default; emitting an explicit null is permitted only when the author opts in per field. The three states — absent (key omitted), explicit null, and empty value — are distinct and MUST be represented distinctly.

### 3.4 Widget contract

A widget MUST accept a value, state, and context, and produce a presentation plus raw-input events. A widget MUST be replaceable by any other widget compatible with the field's interaction style without affecting validation, canonical output, or consumers.

### 3.5 Registry contract

The registry MUST map a category and name to a single resolved definition. A name that resolves in one category MUST NOT implicitly resolve in another. Resolution MUST be deterministic for a given registry state.

### 3.6 Localization contract

A localization key MUST be a flat composite of type, category, message key, and locale. The message-key component for errors and validations MUST be one of the type's declared stable codes (§2.13). The resolver MUST accept a key (and locale) and return a single text string, applying the fallback chain. A missing terminal fallback MUST yield a defined, safe placeholder rather than an error. Locale identifiers MUST use one standard locale-tag form throughout (keys and fallback chain), compared case-insensitively, with a fixed shortest-match fallback (most specific → less specific → default → generic).

### 3.7 State plugin contract

A state plugin MUST provide creation, assignment, and subscription for a field's value/state, keyed by field identity. Subscription MUST notify observers on change. The plugin MUST treat value/state as opaque domain output and MUST NOT transform it.

### 3.8 Invariants

- Canonical output MUST depend only on raw input, type, applicable standards, and the explicit context required to interpret the input — never on widget, state plugin, or display locale.
- View output and user-facing text MAY depend on locale and context; canonical output MUST be locale-independent.
- For any value, the canonical projection MUST be reproducible from the raw input, type, and explicit context alone — no ambient environment may be read.
- A field MUST always be in a well-defined state, including for empty and invalid input.
- Removing the state and localization layers MUST NOT change any canonical projection.
- An aggregate MUST NOT change how any member field compiles its own value; dependencies MAY affect only validity, requiredness, and visibility.

### 3.9 Aggregate (virtual-form) contract

An aggregate MUST accept an ordered set of member fields and produce: a combined canonical record keyed by each member's name, a combined validity (true only when all required members are valid and all declared dependencies hold), and a combined collection of member errors/warnings. It MUST emit the combined canonical record only when valid. Member identity MUST be unique within the aggregate's scope. The aggregate MUST be a pure function of its members' values and the explicit context.

---

## 4. Behavior & Edge Cases

### 4.1 Empty input

An empty raw input MUST produce a defined state and MUST NOT be silently coerced to null. If the field is required, the state MUST be invalid with a required-error. If optional, the state MUST be valid and the field's key MUST be **omitted** (absent) from the canonical record by default; an explicit null is emitted only if the author opted in for that field. Absent, explicit null, and empty value remain three distinct outcomes.

### 4.2 Parse failure

If parsing fails, the field MUST be invalid, MUST surface an appropriate error, MUST retain the raw input, and MUST NOT emit a canonical projection.

### 4.3 Valid-but-out-of-constraint

A value that parses but violates a declared constraint (bounds, pattern, uniqueness, item count) MUST be invalid with a corresponding validation message, and MUST NOT emit a canonical projection.

### 4.4 Normalization ambiguity

When a standard permits multiple equivalent representations, normalization MUST collapse them to the single chosen canonical form so that equivalent inputs yield identical canonical output.

### 4.5 Time conversion

Local-to-universal and universal-to-local conversions MUST preserve the represented instant. Ambiguous or non-existent local times around offset transitions MUST resolve deterministically: an **ambiguous** local time (an instant that occurs twice) MUST resolve to the **earlier** offset; a **non-existent** local time (an instant skipped by the transition) MUST be **shifted forward** by the gap. This rule MUST be applied uniformly.

### 4.6 Locale fallback

If text for the requested locale is absent, resolution MUST fall back to the default locale, then to a generic key, then to a safe placeholder. Fallback MUST NOT throw.

### 4.7 Inference conflict

Inference MUST follow a fixed precedence, highest first: explicit author configuration → shape/value evidence → name-based heuristic → generic default. Each tier MUST be deterministic. If both an explicit configuration and an inferable default exist, the explicit configuration MUST win. If inference is ambiguous, the system MUST choose the deterministic generic default and MUST NOT fail.

### 4.8 Unknown registry name

Resolving an unregistered name MUST fail in a defined, observable way (a defined error or safe default), and MUST NOT silently substitute an unrelated definition.

### 4.9 Editability flags

Disabled, read-only, and hidden states MUST affect interaction and presentation only; they MUST NOT alter how a present value is compiled or projected.

### 4.10 Collection edge cases

Empty collections, duplicate items under a uniqueness rule, and counts outside item-count bounds MUST each produce a defined validity outcome with an appropriate message.

### 4.11 Validation composition

Type-intrinsic validation MUST run before author-declared constraints. The system MUST NOT short-circuit: it MUST evaluate and report **all** applicable failures (errors and warnings) in a stable, deterministic order so reported messages are reproducible.

### 4.12 Dependency & aggregate edge cases

A dependency referencing a missing, invalid, or not-yet-entered field MUST resolve deterministically to a defined outcome rather than failing. Cyclic dependencies MUST be detected and reported, not evaluated indefinitely. An aggregate with any invalid required member MUST be invalid and MUST NOT emit its combined canonical record.

### 4.13 Asynchronous resolution

The core pipeline MUST be synchronous and pure. Any asynchronous work (e.g. a supplementary external validator or async registry resolution) MUST be explicitly marked, MUST run outside the core pipeline, and MUST surface as a distinct **pending** state. A pending result MAY later add errors/warnings but MUST NOT retroactively change a canonical projection already produced from synchronous, deterministic inputs.

---

## 5. Non-Functional Expectations

- **Determinism** — Identical (raw, type, explicit context) inputs MUST yield identical outputs across runs and environments. Environment-dependent values MUST be passed as explicit context, never read ambiently.
- **Isolation** — The domain core MUST be independent of presentation, state, localization, and transport. Adapters MUST be replaceable without domain changes.
- **Performance** — Per-input compilation SHOULD be efficient enough for interactive feedback; an optional fast-path pattern check SHOULD avoid expensive parsing of obviously invalid input.
- **Safety** — Canonical output MUST be machine-safe and standard-conformant; the system MUST NOT emit canonical output it cannot validate. All raw input is untrusted and bounded (§2.18).
- **Versioning** — The type registry and its canonical forms MUST be versioned as a whole. Canonical output MUST be interpretable against the registry version in effect when it was produced; canonical forms MUST evolve in a backward-compatible (append-only) manner so previously produced output remains valid.
- **Extensibility** — New types, widgets, formats, serializers, validators, and a state plugin MUST be addable through the registry without modifying the domain core.
- **Resilience** — No layer's absence or failure (state, localization, widget) may corrupt canonical truth; degraded layers MUST fall back to defined safe behavior.
- **Minimal surface** — The author-facing API SHOULD remain small; internal complexity MUST be compiled away behind inference and canonicalization.
- **Approachability** — Every author-facing setting (including the fractional scale of §2.6) MUST be expressible by a non-technical author through a single simple value or pattern, with a working default in its absence. No author-facing configuration may require knowledge of the domain core, numeric representation, or standards internals.

---

## 6. Resolved Decisions

All previously open questions are now resolved and folded into the normative sections above. Recorded here for traceability.

1. **Standard selection precedence** → §2.4: most-specific applicable standard wins; ties broken by a fixed declared per-meaning priority order.
2. **Decimal/precision policy** → §2.6, §3.3: no precision/rounding arithmetic; fidelity-losing values carried/emitted as exact strings; trailing-zero / fraction width set by a configurable, non-technical **scale** (lossless padding; over-scale input invalid, never rounded).
3. **Time disambiguation** → §4.5: ambiguous local time → earlier offset; non-existent local time → shift forward by the gap.
4. **Validation composition** → §4.11: type-intrinsic before author constraints; no short-circuit; report all failures in a stable order.
5. **Async resolution** → §4.13: core pipeline synchronous and pure; async only as marked supplementary work surfacing a distinct **pending** state, never altering already-produced canonical output.
6. **Diagnostic projection scope** → §3.3: may expose stage intermediates and timing; off by default; never canonical truth.
7. **Inference precedence** → §4.7: explicit config → shape/value → name heuristic → generic default, deterministic at every tier.
8. **Locale identifier format** → §3.6: one standard locale-tag form everywhere, case-insensitive, fixed shortest-match fallback.
9. **Collection-vs-scalar bounds** → §2.8: the resolved type decides (collection → item-count, otherwise → magnitude).
10. **Versioning** → §5: registry and canonical forms versioned as a whole; output interpreted against its production-time version; forms evolve append-only/backward-compatible.
11. **Cross-field dependencies** → §2.16, §3.9, §4.12: supported in the application layer; the domain core/type stays self-contained.
12. **Absent vs null vs empty** → §3.3, §4.1: empty never coerced to null; optional-empty omits the key by default; explicit null only on opt-in; three distinct states.
13. **Aggregate (virtual-form)** → §2.17, §3.9: fields compose into one combined canonical record + combined validity, above the domain core.
14. **Locale-aware input vs locale-independent output** → §2.2, §3.8: parsing MAY use locale; parsed value and canonical MUST be locale-independent.
15. **Warnings semantics** → §2.7: errors block and suppress canonical; warnings are non-blocking advisories.
16. **Error/validation code taxonomy** → §2.13, §3.6: each type declares stable enumerable codes that dictionary keys bind to.
17. **Round-trip idempotency** → §3.1: `serialize(deserialize(canonical)) == canonical` for valid values.
18. **Ambient environment as explicit context** → §2.2, §3.8, §5: current instant/timezone/locale passed in, never read ambiently.
19. **Default-value semantics** → §2.8: default seeds via the same pipeline, field starts not-modified/not-touched, default must satisfy constraints.
20. **Untrusted input** → §2.18: bounded length, bounded-time patterns, no execution/interpolation of raw input.

## 7. Resolved Sub-Questions

All three remaining sub-questions are now decided and reflected in the implementation.

### 7.1 Canonical string normalization (numeric)

For string-encoded numeric canonical forms: the integer part MUST have no leading zeros except a single `0` for a zero integer part; a negative sign MUST be the only sign and MUST be dropped for a zero magnitude (no negative zero); a positive sign MUST never be emitted; the fractional part MUST be present exactly to the declared scale (trailing zeros only as the scale dictates) and otherwise preserved as entered. Equivalent inputs (e.g. `01.50`, `+1.5` at scale 2) therefore collapse to one canonical string (`1.50`).

### 7.2 Dependency expression surface

Cross-field dependencies (§2.16) are declared on a field as simple, non-technical condition attributes evaluated by an enclosing virtual-form (§2.17): a field MAY declare that it is *required-if*, *visible-if*, *hidden-if*, or *valid-if* a condition over sibling fields holds, with an optional human message for a failed *valid-if*. Conditions are a minimal comparison language (`==`, `!=`, `>`, `<`, `>=`, `<=`, joined by `and`/`or`) over sibling field names and literal values — no code, no evaluation of arbitrary expressions (§2.18). Dependency effects MUST affect only validity, requiredness, and visibility, never a field's canonical value, and MUST be evaluated above the domain core.

### 7.3 Standard catalogue (per-meaning)

The canonical standard chosen per governed meaning (§2.4), most-specific-wins with the fixed priority below:

| Meaning | Canonical standard | Canonical form |
| --- | --- | --- |
| date-time | ISO 8601 / RFC 3339 | UTC instant string |
| date | ISO 8601 | `YYYY-MM-DD` (zoneless) |
| time of day | ISO 8601 (local time) | `HH:MM:SS` (zoneless) |
| duration | ISO 8601 | duration string |
| unique id | RFC 9562 (UUID) | lowercase |
| email | RFC 5322 (practical) | local kept, domain lowercased |
| web address | RFC 3986 | scheme/host lowercased |
| IPv4 / IPv6 | RFC 791 / RFC 4291 | dotted quad / compressed lowercase |
| telephone | E.164 | `+<digits>` |
| country | ISO 3166-1 alpha-2 | uppercase |
| currency code | ISO 4217 | uppercase |
| money amount | ISO 4217 + exact decimal | `{ amount: string, currency }` |
| language | BCP-47 | language lowercase, region uppercase |
| time zone | IANA TZDB | canonical IANA id |
