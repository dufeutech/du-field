# ui-field: A Semantic Type Runtime for Human Input

## A Hexagonal, Plugin-Based, Canonical Data System with Dual Projection and Internationalization

---

# 0. Abstract

This document defines a system for building user input interfaces as a **semantic runtime**, rather than a component library.

Instead of forms composed of widgets, we define:

> A single primitive `<ui-field>` that compiles human input into canonical, standardized, machine-safe data.

The system introduces:

- Canonical type system (OpenAPI + ISO/RFC aligned)
- Dual representation model (view vs canonical)
- Hexagonal architecture (domain-first design)
- Plugin-based state system (optional NanoStores)
- Widget adapters (UI layer)
- Internationalization system (flat-key i18n dictionary)
- Convention-over-configuration type inference

---

# 1. Core Principle

> Forms are not UI. Forms are **semantic compilers of human intent**.

Every field is:

```txt
input string
  → filtered
  → parsed
  → validated
  → normalized
  → projected
  → serialized (canonical)
```

````

---

# 2. Architecture Overview (Hexagonal + Minimal DDD)

```txt
                    ┌────────────────────┐
                    │     UI Layer       │
                    │  (Widgets)         │
                    └─────────┬──────────┘
                              │
              ┌───────────────▼────────────────┐
              │     Application Layer           │
              │  - lifecycle                    │
              │  - field orchestration          │
              │  - projection engine            │
              │  - state coordination           │
              └───────────────┬────────────────┘
                              │
              ┌───────────────▼────────────────┐
              │       Domain Core               │
              │  - types (int32, uuid, etc)    │
              │  - validation rules            │
              │  - normalization (ISO/RFC)     │
              │  - canonical contracts         │
              └───────────────┬────────────────┘
                              │
      ┌───────────────────────▼────────────────────────┐
      │             Adapter Layer (Ports)              │
      │  - NanoStores (optional)                      │
      │  - React/Vue/Svelte bindings                  │
      │  - API serializers                            │
      │  - persistence adapters                       │
      └───────────────────────────────────────────────┘
```

---

# 3. Core Field Model

Each field is a runtime entity:

```ts
FieldInstance {
  id: string;

  type: string;     // int32, datetime, email...
  use: string;      // input, select, calendar...

  state: FieldState;
}
```

---

# 4. Dual Representation Model

Every value is split into two projections:

```ts
FieldValue<T> = {
  raw: string;

  view: any;        // human-readable
  canonical: any;   // machine-safe (API output)

  valid: boolean;
}
```

---

# 5. Canonical Type System

## 5.1 Primitive Types

```txt
string
bool

int32
int64

float32
float64

decimal
```

---

## 5.2 Semantic Types (RFC / ISO aligned)

```txt
email        → RFC 5322
uuid         → RFC 9562
url          → RFC 3986
ipv4         → RFC 791
ipv6         → RFC 4291
datetime     → ISO 8601 / RFC 3339
duration     → ISO 8601
currency     → ISO 4217
language     → BCP-47
timezone     → IANA TZDB
```

---

## 5.3 Collection Types

```txt
array
object
any
```

---

# 6. Validation Pipeline

Every type implements:

```ts
TypeDefinition<T> {
  filter(raw: string): string;
  parse(raw: string): T;
  validate(value: T): boolean;
  normalize(value: T): T;
  serialize(value: T): any;
}
```

Pipeline:

```txt
raw input
  → filter
  → regex (optional fast-path)
  → parse
  → semantic validation
  → normalize
  → canonical output
```

---

# 7. Canonical Output Rules

If a global standard exists (ISO / RFC / BCP / W3C):

> The canonical output MUST follow it.

Examples:

- datetime → ISO 8601 UTC
- uuid → lowercase RFC format
- phone → E.164
- country → ISO 3166-1 alpha-2
- language → BCP-47

---

# 8. Time Model (Dual Projection Required)

Time is always:

```ts
{
  view: "local datetime",
  canonical: "UTC ISO 8601",
  epoch: number
}
```

Rule:

- UI always displays LOCAL
- API always receives UTC

---

# 9. Widget Layer (UI Adapters)

Widgets are purely presentational:

```ts
Widget {
  render(value, state, context): UI;
}
```

Widgets DO NOT:

- validate
- normalize
- parse
- mutate domain logic

Examples:

- calendar
- slider
- tags
- masked input
- select dropdown

---

# 10. State Layer (Plugin-Based)

## 10.1 Default

Stateless or internal runtime state.

---

## 10.2 Optional NanoStores Plugin

State is fully externalizable:

```ts
StatePlugin {
  create(id): Store<FieldValue>;
  set(id, value): void;
  subscribe(id, fn): void;
}
```

### NanoStores Adapter

```ts
atom({
  raw: "",
  view: null,
  canonical: null,
  valid: false,
});
```

Rule:

> State layer must NEVER influence domain logic.

---

# 11. Registry System

Central system of truth:

```ts
registry.type("int32", Int32Type);
registry.type("datetime", DateTimeType);
registry.widget("calendar", CalendarWidget);
registry.format("email", EmailFormat);
```

---

# 12. Internationalization System (i18n Layer)

## 12.1 Core Principle

All user-facing text is resolved through a **flat dictionary key system**.

No nested JSON trees.

---

## 12.2 Key Format

```txt
<type>:<category>:<key>:<locale>
```

Examples:

```txt
email:label:us_en
email:help:us_en
email:error.required:us_en
datetime:label:us_en
datetime:error.invalid:us_en
```

---

## 12.3 Flat Dictionary Structure

All translations stored in a single flat object:

```ts
i18n = {
  "email:label:us_en": "Email",
  "email:help:us_en": "We will never spam you.",
  "email:error.required:us_en": "Email is required",

  "datetime:label:us_en": "Date & Time",
  "datetime:error.invalid:us_en": "Invalid date format",
};
```

---

## 12.4 Resolution Function

```ts
i18n(key: string, locale: string) => string
```

Lookup strategy:

```txt
1. exact match: type:category:locale
2. fallback locale (en)
3. fallback generic key
```

---

## 12.5 Categories

### Labels

```txt
type:label:locale
```

---

### Help Text

```txt
type:help:locale
```

---

### Error Messages

```txt
type:error.<code>:locale
```

---

### Validation Messages

```txt
type:validation.<rule>:locale
```

---

## 12.6 Example Usage

```ts
i18n("email:error.required:us_en")
→ "Email is required"
```

---

# 13. Convention Over Configuration

If missing metadata:

### Type inference

```txt
email → string:email
age → int32
price → float64
created_at → datetime
```

---

### Widget inference

```txt
int32 → input:number
datetime → calendar
bool → switch
```

---

### i18n inference

```txt
email → "Email"
created_at → "Created At"
```

---

# 14. Field Lifecycle

```txt
user input
  ↓
filter
  ↓
parse
  ↓
validate
  ↓
normalize
  ↓
state update (plugin)
  ↓
projection (view/canonical)
  ↓
i18n resolution (labels/errors/help)
  ↓
widget render
```

---

# 15. Separation of Concerns (Strict Rules)

## Domain Core

- validation
- normalization
- canonical formats
- type logic

---

## Application Layer

- orchestration
- lifecycle
- projection engine
- registry resolution

---

## Adapters

- UI widgets
- state plugins
- i18n system
- API serialization

---

# 16. Key Design Principles

## 16.1 Single Primitive

```html
<ui-field />
```

Everything else is configuration.

---

## 16.2 Type = Codec

```txt
type =
filter + parse + validate + normalize + serialize
```

---

## 16.3 UI is Disposable

Widgets can change without affecting:

- validation
- canonical output
- APIs

---

## 16.4 Canonical Always Wins

All APIs receive:

- ISO
- RFC
- BCP
- OpenAPI-safe formats

---

## 16.5 State is External

State system is always optional and pluggable.

---

## 16.6 i18n is Data, Not UI

Text is never hardcoded in widgets.

It is resolved via:

> flat key → locale lookup → runtime injection

---

# 17. Final System Definition

This system is:

> A **hexagonal semantic runtime for human input**

It compiles:

- human intent
- into canonical structured data
- through validated domain types
- with optional UI, state, and localization layers

---

# 18. Long-Term Vision

The system evolves into:

> a universal compiler from human input → machine-safe semantic data models

where:

- forms disappear
- widgets become interchangeable adapters
- validation is intrinsic to type semantics
- localization is a runtime projection
- APIs only see canonical truth

---

# 1. Core Field Model (runtime entity)

These are the _structural fields every `ui-field` instance can have_:

### Primary identifiers

- `use`
- `type`

### Identity / metadata

- `id`
- `name`

### Value model

- `raw`
- `view`
- `canonical`

### State

- `valid`
- `dirty`
- `touched`
- `errors`
- `warnings`

### Lifecycle

- `state` (aggregate container)

---

### ✔ Subtotal: 12 fields

---

# 2. Value System (field configuration inputs)

These are _user-declared or inferred constraints_:

### Limits

- `min`
- `max`
- `step`

### Defaults

- `value`

### Constraints

- `match` (regex or semantic matcher)
- `required`
- `disabled`
- `readonly`
- `hidden`

---

### ✔ Subtotal: 10 fields

---

# 3. Choice / Collection Model

### Options

- `choices`

### Collection behavior

- `multiple`
- `unique`
- `max_items`
- `min_items`

(you abstracted these later into `min/max`, but they still exist logically)

---

### ✔ Subtotal: 4 fields

---

# 4. UI / Widget Layer

### Rendering behavior

- `widget` (derived from `use`, but still exists logically)
- `variant`
- `size`
- `inline`
- `compact`
- `icon`

---

### ✔ Subtotal: 6 fields

---

# 5. Projection System (dual representation)

### Core projections

- `raw`
- `view`
- `canonical`

### Time-specific projection extension (important subclass concept)

- `local`
- `utc`
- `epoch`

### Optional debug projection

- `debug`

---

### ✔ Subtotal: 7 fields

---

# 6. Type System (canonical type descriptors)

These are NOT runtime values but schema-level fields:

### Primitive types

- `string`
- `bool`
- `int32`
- `int64`
- `float32`
- `float64`
- `decimal`

### Semantic types

- `email`
- `uuid`
- `url`
- `ipv4`
- `ipv6`
- `datetime`
- `date`
- `duration`
- `currency`
- `language`
- `timezone`
- `json`
- `array`
- `object`
- `any`

---

### ✔ Subtotal: 19+ type identifiers (not “fields”, but registry surface)

---

# 7. Validation Pipeline Fields (internal engine)

These are _per-type function hooks_:

- `filter`
- `regex`
- `parse`
- `validate`
- `normalize`
- `serialize`
- `deserialize`

---

### ✔ Subtotal: 7 pipeline functions

---

# 8. Registry System

### Registry categories

- `type`
- `widget`
- `format`
- `serializer`
- `validator`

---

### ✔ Subtotal: 5 registry domains

---

# 9. i18n System (flat-key model)

### Key structure components

- `type`
- `category` (label/help/error/validation)
- `message_key`
- `locale`

---

### Logical fields:

- `label`
- `help_text`
- `error_messages`
- `validation_messages`

---

### ✔ Subtotal: 4 semantic categories (flattened into string keys)

---

# 10. Plugin System (State + Extensibility)

### State plugin interface

- `create`
- `set`
- `subscribe`

### Plugin types

- `state_plugin`
- `widget_plugin`
- `type_plugin`
- `serializer_plugin`

---

### ✔ Subtotal: 4 plugin surfaces

---

# 11. TOTAL COUNT (REAL DESIGN SURFACE)

We separate by meaningful categories:

| Layer              | Count |
| ------------------ | ----- |
| Core field runtime | 12    |
| Value constraints  | 10    |
| Collection model   | 4     |
| UI layer           | 6     |
| Projection system  | 7     |
| Pipeline hooks     | 7     |
| Registry surfaces  | 5     |
| i18n categories    | 4     |
| Plugin surfaces    | 4     |

---

## 🧮 GRAND TOTAL (distinct system fields)

```txt
= 59 conceptual fields / system knobs
```

---

# 12. Important Insight (Architectural Reality Check)

This number is actually:

> **the upper bound of complexity your system exposes**

BUT in practice:

### Developer-facing API surface is only:

```txt
~6 core concepts
```

- `use`
- `type`
- `value`
- `min/max`
- `choices`
- `required`

Everything else is:

- inferred
- canonicalized
- or plugin-level

---

# 13. Key Design Interpretation

Your system is:

> **59 internal primitives → compiled into ~6 user primitives**

That is exactly what makes it powerful.

---

# 14. Progress Tracking Suggestion

If you want to track implementation maturity, use this instead:

## Phase 1 (Core Runtime)

- [x] type system
- [x] validation pipeline
- [x] canonical output
- [x] registry

## Phase 2 (Projection System)

- [x] view/canonical split
- [x] time dual model
- [x] currency/location models

## Phase 3 (Adapters)

- [x] widget system
- [x] NanoStores plugin
- [x] framework bindings (vanilla `<ui-field>` / `<ui-form>` custom elements + Preact playground)

## Phase 4 (i18n layer)

- [x] flat dictionary resolver
- [x] locale fallback chain
- [x] error/help injection

## Beyond the original plan

- [x] cross-field dependencies + virtual-form (`<ui-form>`, declarative `required-if` / `visible-if` / `hidden-if` / `valid-if`)
- [x] collection types (array / object / any)
- [x] untrusted-input bounds, deterministic explicit-context model
````
