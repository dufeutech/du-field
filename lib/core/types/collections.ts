/**
 * COLLECTION TYPES — codecs for aggregate, container-shaped values (RFC §2.9,
 * §5.3). Three types live here:
 *
 *   array  → an ordered list of items (tags / comma-separated entry).
 *   object → an unordered map of string keys to values.
 *   any    → an unconstrained passthrough value (escape hatch).
 *
 * The codec shape mirrors the primitives / semantic modules:
 *
 *   filter   → light cleanup (trim); never parses.
 *   parse    → assume a non-empty raw (the engine handles empty per §4.1);
 *              return { ok:false, code:'invalid' } on a malformed instance.
 *   validate → type-intrinsic + collection constraints (item-count / unique)
 *              owned DIRECTLY here per §2.9 / §4.10. Collect ALL issues, never
 *              short-circuit (RFC §4.11). Only stable `codes` are emitted.
 *   normalize→ collapse equivalent inputs to a single standardized internal form
 *              (RFC §4.4). Uniqueness is VALIDATED, never silently fixed.
 *   serialize→ canonical, machine-safe, locale-independent projection.
 *   deserialize → inverse of serialize; round-trip idempotent (RFC §3.1).
 *   view     → human projection.
 *   project  → optional extended projections (RFC §2.5, §3.3).
 *
 * Purity (RFC §3.8, rules §3): no DOM, no framework, no ambient reads. The
 * environment is consulted ONLY through the passed `ctx`.
 */

import type {
  TypeDefinition,
  Context,
  Constraints,
  ParseResult,
  ValidationResult,
  Issue,
} from '../contracts';

/* ------------------------------------------------------------------ *
 * Shared helpers (local, deterministic — never imported from sibling type
 * modules so this file stays self-contained).
 * ------------------------------------------------------------------ */

/** Build a ValidationResult from already-collected lists. */
function result(errors: Issue[], warnings: Issue[]): ValidationResult {
  return { errors, warnings };
}

/** Failure shorthand for parse/deserialize. */
function fail(code: string): { ok: false; code: string } {
  return { ok: false, code };
}

/**
 * Deterministic key-sort: object keys sorted recursively, arrays keep order.
 * Mirrors the semantic module's `sortValue` so canonical objects are stable.
 */
function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) {
      out[key] = sortValue(src[key]);
    }
    return out;
  }
  return value;
}

/** Deterministic JSON text (sorted object keys). */
function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

/* ================================================================== *
 * array — T = unknown[].
 *   parse: a JSON array (leading '['), or a comma-separated list of trimmed,
 *          non-empty string items.
 *   validate: item-count + uniqueness handled DIRECTLY here (§2.9 / §4.10).
 *   serialize: the array itself (locale-independent).
 *   view: items joined with ", ".
 *   project: { count, items }.
 * ================================================================== */

/** Split a comma-separated list into trimmed, non-empty string items. */
function splitCommaList(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (trimmed.length > 0) out.push(trimmed);
  }
  return out;
}

/** Coerce arbitrary canonical input into an array, or null when impossible. */
function coerceArray(input: unknown): unknown[] | null {
  if (Array.isArray(input)) return input;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed.length === 0) return null;
    if (trimmed[0] === '[') {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed : null;
      } catch {
        return null;
      }
    }
    return splitCommaList(trimmed);
  }
  return null;
}

export const arrayType: TypeDefinition<unknown[]> = {
  name: 'array',
  codes: ['invalid', 'minItems', 'maxItems', 'unique'] as const,
  defaultUse: 'tags',

  filter(raw: string, _constraints: Constraints, _ctx: Context): string {
    return raw.trim();
  },

  parse(raw: string, _constraints: Constraints, _ctx: Context): ParseResult<unknown[]> {
    const trimmed = raw.trim();
    if (trimmed[0] === '[') {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (!Array.isArray(parsed)) return fail('invalid');
        return { ok: true, value: parsed };
      } catch {
        return fail('invalid');
      }
    }
    // Comma-separated list → trimmed string items, empties dropped.
    return { ok: true, value: splitCommaList(trimmed) };
  },

  validate(value: unknown[], c: Constraints, _ctx: Context): ValidationResult {
    const errors: Issue[] = [];

    if (c.minItems !== undefined && value.length < c.minItems) {
      errors.push({ code: 'minItems', params: { min: c.minItems } });
    }
    if (c.maxItems !== undefined && value.length > c.maxItems) {
      errors.push({ code: 'maxItems', params: { max: c.maxItems } });
    }
    if (c.unique) {
      const seen = new Set<string>();
      let duplicate = false;
      for (const item of value) {
        const key = JSON.stringify(item);
        if (seen.has(key)) {
          duplicate = true;
          break;
        }
        seen.add(key);
      }
      if (duplicate) errors.push({ code: 'unique' });
    }

    return result(errors, []);
  },

  normalize(value: unknown[], _c: Constraints, _ctx: Context): unknown[] {
    // Trim string items; uniqueness is validated, never silently de-duped.
    return value.map((item) => (typeof item === 'string' ? item.trim() : item));
  },

  serialize(value: unknown[], _c: Constraints, _ctx: Context): unknown {
    // Canonical = the array itself (locale-independent).
    return value;
  },

  deserialize(canonical: unknown, _ctx: Context): ParseResult<unknown[]> {
    const arr = coerceArray(canonical);
    if (!arr) return fail('invalid');
    return { ok: true, value: arr };
  },

  view(value: unknown[], _c: Constraints, _ctx: Context): unknown {
    return value
      .map((item) => (typeof item === 'string' ? item : stableStringify(item)))
      .join(', ');
  },

  project(value: unknown[], _c: Constraints, _ctx: Context): Record<string, unknown> {
    return { count: value.length, items: value };
  },
};

/* ================================================================== *
 * object — T = Record<string, unknown>.
 *   parse: a JSON object (leading '{'); malformed → 'invalid'.
 *   normalize: deep deterministic key-sorting.
 *   serialize: the sorted object. view: pretty 2-space JSON. project: { keys }.
 * ================================================================== */

/** Coerce arbitrary canonical input into a plain object, or null. */
function coerceObject(input: unknown): Record<string, unknown> | null {
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed[0] !== '{') return null;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return isPlainObject(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return isPlainObject(input) ? input : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export const objectType: TypeDefinition<Record<string, unknown>> = {
  name: 'object',
  codes: ['invalid'] as const,
  defaultUse: 'input',

  filter(raw: string, _constraints: Constraints, _ctx: Context): string {
    return raw.trim();
  },

  parse(raw: string, _constraints: Constraints, _ctx: Context): ParseResult<Record<string, unknown>> {
    const trimmed = raw.trim();
    if (trimmed[0] !== '{') return fail('invalid');
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (!isPlainObject(parsed)) return fail('invalid');
      return { ok: true, value: parsed };
    } catch {
      return fail('invalid');
    }
  },

  validate(value: Record<string, unknown>, _c: Constraints, _ctx: Context): ValidationResult {
    // Guard against a non-serializable value (e.g. injected functions/symbols).
    const errors: Issue[] = [];
    try {
      JSON.stringify(value);
    } catch {
      errors.push({ code: 'invalid' });
    }
    return result(errors, []);
  },

  normalize(
    value: Record<string, unknown>,
    _c: Constraints,
    _ctx: Context,
  ): Record<string, unknown> {
    return sortValue(value) as Record<string, unknown>;
  },

  serialize(value: Record<string, unknown>, _c: Constraints, _ctx: Context): unknown {
    return sortValue(value);
  },

  deserialize(canonical: unknown, _ctx: Context): ParseResult<Record<string, unknown>> {
    const obj = coerceObject(canonical);
    if (!obj) return fail('invalid');
    return { ok: true, value: sortValue(obj) as Record<string, unknown> };
  },

  view(value: Record<string, unknown>, _c: Constraints, _ctx: Context): unknown {
    return JSON.stringify(sortValue(value), null, 2);
  },

  project(
    value: Record<string, unknown>,
    _c: Constraints,
    _ctx: Context,
  ): Record<string, unknown> {
    return { keys: Object.keys(value).sort() };
  },
};

/* ================================================================== *
 * any — T = unknown. An unconstrained escape hatch.
 *   parse: try JSON.parse; on throw treat the raw string as the value. Never
 *          fails. validate: always valid. serialize: the value. view: the raw
 *          string for a string value, else deterministic JSON.
 * ================================================================== */

export const anyType: TypeDefinition<unknown> = {
  name: 'any',
  codes: [] as const,
  defaultUse: 'input',

  filter(raw: string, _constraints: Constraints, _ctx: Context): string {
    return raw;
  },

  parse(raw: string, _constraints: Constraints, _ctx: Context): ParseResult<unknown> {
    try {
      return { ok: true, value: JSON.parse(raw) };
    } catch {
      // A plain (non-JSON) string is itself a valid value.
      return { ok: true, value: raw };
    }
  },

  validate(_value: unknown, _c: Constraints, _ctx: Context): ValidationResult {
    return result([], []);
  },

  normalize(value: unknown, _c: Constraints, _ctx: Context): unknown {
    return value;
  },

  serialize(value: unknown, _c: Constraints, _ctx: Context): unknown {
    return value;
  },

  deserialize(canonical: unknown, _ctx: Context): ParseResult<unknown> {
    return { ok: true, value: canonical };
  },

  view(value: unknown, _c: Constraints, _ctx: Context): unknown {
    return typeof value === 'string' ? value : stableStringify(value);
  },
};

/* ------------------------------------------------------------------ *
 * Registry bundle
 * ------------------------------------------------------------------ */

export const collectionTypes: TypeDefinition[] = [arrayType, objectType, anyType];
