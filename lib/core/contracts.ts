/**
 * KERNEL CONTRACTS — the shared integration surface for the whole runtime.
 *
 * This file is the single source of truth for the shapes every layer agrees on.
 * It is PURE: no framework, no DOM, no I/O, no ambient reads (see ./rules.md §3
 * "Purity in the core" and "Explicit over ambient"). Every other module conforms
 * to these types; nothing here imports from an outer layer.
 *
 * Cross-references point at docs-sys/rfc.md sections.
 */

/* ------------------------------------------------------------------ *
 * Context (RFC §2.2, §3.8) — explicit environment, never read ambiently.
 * ------------------------------------------------------------------ */

/** Everything a pure computation may need from the environment. */
export interface Context {
  /** Current instant as epoch milliseconds. */
  now: number;
  /** Active IANA time-zone identifier (e.g. "America/New_York"). */
  timeZone: string;
  /** Active BCP-47 locale tag (e.g. "en-US"), compared case-insensitively. */
  locale: string;
}

/* ------------------------------------------------------------------ *
 * Canonical absence (RFC §3.3, §4.1) — absent vs null vs empty are distinct.
 * ------------------------------------------------------------------ */

/** Sentinel meaning "omit this key from the canonical record". */
export const ABSENT = Symbol.for('du-field.absent');
export type Absent = typeof ABSENT;

/** A canonical projection: a concrete value, an explicit null (opt-in), or absent. */
export type Canonical = unknown | null | Absent;

/* ------------------------------------------------------------------ *
 * Value & state (RFC §2.7, §3.3, §4.13)
 * ------------------------------------------------------------------ */

/** The dual-projection value carried by a field. */
export interface FieldValue {
  /** Raw string exactly as entered. */
  raw: string;
  /** Human-facing projection (locale/context dependent). */
  view: unknown;
  /** Machine-facing projection (locale-independent); ABSENT/null per §3.3. */
  canonical: Canonical;
  /** Convenience mirror of FieldState.valid. */
  valid: boolean;
  /**
   * Optional type-specific extended projections, present only when valid
   * (RFC §2.5, §3.3). E.g. time → { local, utc, epoch }; money →
   * { amount, currency, formatted }. Never consumed as canonical truth.
   */
  projections?: Readonly<Record<string, unknown>>;
}

/** A surfaced error or warning. The message is resolved later via i18n by `code`. */
export interface Issue {
  /** Stable, enumerable code declared by the type (RFC §2.13). */
  code: string;
  /** Optional interpolation params for the resolved message. */
  params?: Readonly<Record<string, unknown>>;
}

/** Observable field state (RFC §2.7). Errors block output; warnings do not. */
export interface FieldState {
  valid: boolean;
  /** Modified from its initial/default value. */
  dirty: boolean;
  /** Interacted with by a human. */
  touched: boolean;
  /** Supplementary async work in flight (RFC §4.13). */
  pending: boolean;
  errors: Issue[];
  warnings: Issue[];
}

/* ------------------------------------------------------------------ *
 * Constraints (RFC §2.8) — author-declared, all optional, all defaulted.
 * Numeric bounds/step/default are strings so exact (string-encoded) numeric
 * types never lose fidelity (RFC §2.6). The resolved type decides whether
 * min/max mean magnitude or item-count (RFC §2.8).
 * ------------------------------------------------------------------ */

export interface Choice {
  value: string;
  /** Optional explicit label key; otherwise inferred/looked up. */
  labelKey?: string;
}

export interface Constraints {
  required?: boolean;
  min?: string;
  max?: string;
  step?: string;
  /** Fractional-digit scale for numeric types (RFC §2.6). */
  scale?: number;
  /**
   * Numeric input style. When true, the field accepts plain dot-decimal input
   * (`.` = decimal, `,` = grouping) regardless of locale; when false/omitted,
   * separators follow the active locale (RFC §2.2). View output is unaffected.
   */
  dotDecimal?: boolean;
  /** ISO 4217 currency code for monetary types (e.g. "USD"). */
  currency?: string;
  /** Pattern matcher; must be evaluable in bounded time (RFC §2.18). */
  match?: string;
  multiple?: boolean;
  unique?: boolean;
  minItems?: number;
  maxItems?: number;
  choices?: readonly Choice[];
  /** Initial value, expressed as raw and compiled through the pipeline (RFC §2.8). */
  default?: string;
  /** Opt in to emit explicit null instead of omitting an empty optional (RFC §3.3). */
  emitNull?: boolean;
  disabled?: boolean;
  readonly?: boolean;
  hidden?: boolean;
}

/* ------------------------------------------------------------------ *
 * Type contract / codec (RFC §2.2, §3.1) — a type fully owns its semantics.
 * A type MUST NOT reference any other field (RFC §2.16).
 * ------------------------------------------------------------------ */

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: string };

export interface ValidationResult {
  errors: Issue[];
  warnings: Issue[];
}

/**
 * A type is a codec: filter → parse → validate → normalize → serialize, plus
 * an inverse (deserialize) and a human projection (view). All methods are pure
 * functions of their inputs and Context.
 *
 * For values that lose fidelity natively (decimals, large/precise integers),
 * the internal representation T MUST be string and serialize MUST return a
 * string (RFC §2.6).
 */
export interface TypeDefinition<T = unknown> {
  /** Registry name, e.g. "int32", "email". */
  readonly name: string;
  /** Stable, enumerable set of codes this type may emit (RFC §2.13). */
  readonly codes: readonly string[];
  /** Default interaction style when none is configured/inferred (RFC §2.12). */
  readonly defaultUse: string;
  /** Optional bounded-time fast-path (RFC §2.2, §2.18). */
  readonly pattern?: RegExp;

  /** Reject/strip disallowed characters before parsing (may depend on constraints). */
  filter(raw: string, constraints: Constraints, ctx: Context): string;
  /** Convert filtered string to internal value, or report a parse code. */
  parse(raw: string, constraints: Constraints, ctx: Context): ParseResult<T>;
  /** Semantic + constraint validation. Errors block output; warnings do not. */
  validate(value: T, constraints: Constraints, ctx: Context): ValidationResult;
  /** Collapse to the single standardized internal form. */
  normalize(value: T, constraints: Constraints, ctx: Context): T;
  /** Produce the canonical (machine-safe, locale-independent) projection. */
  serialize(value: T, constraints: Constraints, ctx: Context): unknown;
  /** Reconstruct an internal value from canonical input; round-trip idempotent (RFC §3.1). */
  deserialize(canonical: unknown, ctx: Context): ParseResult<T>;
  /** Human-facing projection (locale/context dependent). */
  view(value: T, constraints: Constraints, ctx: Context): unknown;
  /**
   * Optional extended projections beyond view/canonical (RFC §2.5, §3.3).
   * Called only on a valid, normalized value. Pure; attaches to
   * FieldValue.projections. E.g. time → { local, utc, epoch }.
   */
  project?(value: T, constraints: Constraints, ctx: Context): Record<string, unknown>;
}

/* ------------------------------------------------------------------ *
 * Registry (RFC §2.11, §3.5) — the single resolution path.
 * ------------------------------------------------------------------ */

export type RegistryCategory =
  | 'type'
  | 'widget'
  | 'format'
  | 'serializer'
  | 'validator';

export interface Registry {
  register(category: RegistryCategory, name: string, value: unknown): void;
  get(category: RegistryCategory, name: string): unknown;
  has(category: RegistryCategory, name: string): boolean;
  /** Convenience for the most common category. */
  registerType(def: TypeDefinition): void;
  getType(name: string): TypeDefinition | undefined;
}

/* ------------------------------------------------------------------ *
 * i18n (RFC §2.13, §3.6) — flat-key dictionary, deterministic fallback.
 * Key format: `<type>:<category>[.<code>]:<locale>`.
 * ------------------------------------------------------------------ */

export type TextCategory = 'label' | 'help' | 'error' | 'validation';

export interface Dictionary {
  readonly [flatKey: string]: string;
}

export interface I18n {
  /** Resolve a fully-formed flat key for a locale, applying the fallback chain. */
  resolve(
    key: string,
    locale: string,
    params?: Readonly<Record<string, unknown>>,
  ): string;
}

/** Resolved, ready-to-display text for one field (built by the runtime). */
export interface TextBundle {
  label: string;
  help: string;
  /** Resolved messages for the field's current errors, in order. */
  errors: string[];
  /** Resolved messages for the field's current warnings, in order. */
  warnings: string[];
}

/* ------------------------------------------------------------------ *
 * State port (RFC §2.14, §3.7) — optional, opaque, never transforms.
 * ------------------------------------------------------------------ */

export interface FieldSnapshot {
  value: FieldValue;
  state: FieldState;
}

export interface StatePort {
  create(id: string, initial: FieldSnapshot): void;
  set(id: string, snapshot: FieldSnapshot): void;
  get(id: string): FieldSnapshot | undefined;
  subscribe(id: string, fn: (snapshot: FieldSnapshot) => void): () => void;
}

/* ------------------------------------------------------------------ *
 * Field (RFC §3.2) — one runtime instance of the single primitive.
 * ------------------------------------------------------------------ */

export interface FieldConfig {
  id?: string;
  name: string;
  /** Inferred from name/shape if omitted (RFC §2.12). */
  type?: string;
  /** Inferred from resolved type if omitted (RFC §2.12). */
  use?: string;
  constraints?: Constraints;
}

export interface Field {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly use: string;
  readonly value: FieldValue;
  readonly state: FieldState;
  /** Apply new raw input through the pipeline using explicit context. */
  setRaw(raw: string, ctx: Context): void;
  /**
   * Proactively filter raw input the way the type would before parsing
   * (RFC §2.2). Lets a widget strip never-valid characters live (e.g. letters
   * in a number) instead of surfacing a reactive error. Pure delegation.
   */
  filter(raw: string, ctx: Context): string;
  /** Mark interacted-with. */
  touch(): void;
  /** Restore the default value; clears dirty/touched (RFC §2.8). */
  reset(ctx: Context): void;
  subscribe(fn: (field: Field) => void): () => void;
}

/* ------------------------------------------------------------------ *
 * Widget contract (RFC §2.10, §3.4) — purely presentational, no domain logic.
 * Framework-agnostic: a widget renders into a host and emits raw input.
 * ------------------------------------------------------------------ */

export interface WidgetProps {
  value: FieldValue;
  state: FieldState;
  text: TextBundle;
  constraints: Constraints;
  use: string;
  /** Emit new raw input back to the field. */
  onInput(raw: string): void;
  /** Signal interaction. */
  onTouch(): void;
  /**
   * Proactively filter raw input (RFC §2.2). A widget MAY apply this to its
   * control as the user types so never-valid characters are removed live. The
   * filtering policy belongs to the type; the widget only applies it.
   */
  filter(raw: string): string;
}

export interface Widget {
  readonly use: string;
  /** Render/update presentation inside the given host element. */
  render(host: HTMLElement, props: WidgetProps): void;
}

/* ------------------------------------------------------------------ *
 * Aggregate / virtual-form (RFC §2.17, §3.9) — application-layer composition.
 * ------------------------------------------------------------------ */

/** A cross-field dependency (RFC §2.16): pure over member values + context. */
export interface Dependency {
  /** Member field names this dependency reads. */
  readonly reads: readonly string[];
  /** Member field name this dependency affects. */
  readonly target: string;
  /**
   * Evaluate the effect on the target given current member values.
   * MUST be pure and MUST NOT change any member's canonical projection.
   */
  evaluate(
    members: Readonly<Record<string, Field>>,
    ctx: Context,
  ): DependencyEffect;
}

export interface DependencyEffect {
  required?: boolean;
  hidden?: boolean;
  /** Extra issues to attach to the target (e.g. "must exceed start"). */
  errors?: Issue[];
}

export interface Aggregate {
  readonly fields: readonly Field[];
  readonly valid: boolean;
  /** Combined canonical record keyed by field name; emitted only when valid. */
  canonical(ctx: Context): Record<string, unknown> | undefined;
  field(name: string): Field | undefined;
  subscribe(fn: (aggregate: Aggregate) => void): () => void;
}
