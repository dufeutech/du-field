/**
 * PRIMITIVE TYPES — built-in `TypeDefinition` codecs (RFC §2.2, §2.6, §2.8, §3.1).
 *
 * This module is PURE (./rules.md §3, RFC §3.8): no DOM, no framework, no ambient
 * reads. Every codec is a deterministic function of its inputs and `Context`.
 *
 * Internal representation policy (RFC §2.6 — numeric fidelity):
 *   - Values whose exact magnitude/precision cannot survive a native JS `number`
 *     are carried as STRINGS and serialize to strings: `int64`, `decimal`.
 *   - Safe-range numerics use `number`: `int32`, `float32`, `float64`.
 *   - `string` uses `string`; `bool` uses `boolean`.
 *
 * For string-encoded numerics, bounds comparison NEVER routes through `Number()`
 * (that would lose fidelity); a sign-aware lexicographic comparator is used so
 * arbitrary-magnitude/precision values compare exactly.
 */

import type {
  TypeDefinition,
  Context,
  Constraints,
  ParseResult,
  ValidationResult,
  Issue,
} from '../contracts';
import type { LocaleSeparators } from './numeric_locale';
import {
  localeSeparators,
  filterNumeric,
  toCanonicalNumeric,
  NUMERIC_FASTPATH,
} from './numeric_locale';

/* ------------------------------------------------------------------ *
 * Shared helpers (pure, no ambient reads).
 * ------------------------------------------------------------------ */

/** Empty validation outcome. */
function ok(): ValidationResult {
  return { errors: [], warnings: [] };
}

function issue(code: string, params?: Record<string, unknown>): Issue {
  return params ? { code, params } : { code };
}

/** Bounded-time test for "all ASCII digits" (RFC §2.18). Non-global → stateless. */
const ALL_DIGITS = /^[0-9]+$/;

/**
 * Numeric input filtering and locale-aware canonicalization live in
 * ./numeric_locale (shared with the money codec).
 */

/** Split a normalized decimal/integer string into sign + integer + fraction parts. */
interface DecimalParts {
  neg: boolean;
  int: string; // leading-zero-stripped integer digits ("" means zero)
  frac: string; // fractional digits without trailing-zero handling
}

/**
 * Parse a textual signed decimal into canonical parts WITHOUT precision loss.
 * Returns undefined when the text is not a well-formed decimal.
 * Accepts optional sign, optional integer part, optional single '.', optional
 * fraction. Requires at least one digit overall.
 */
function decimalParts(text: string): DecimalParts | undefined {
  let s = text;
  let neg = false;
  if (s.length > 0 && (s[0] === '+' || s[0] === '-')) {
    neg = s[0] === '-';
    s = s.slice(1);
  }
  const dot = s.indexOf('.');
  let intRaw: string;
  let fracRaw: string;
  if (dot === -1) {
    intRaw = s;
    fracRaw = '';
  } else {
    if (s.indexOf('.', dot + 1) !== -1) return undefined; // more than one '.'
    intRaw = s.slice(0, dot);
    fracRaw = s.slice(dot + 1);
  }
  // Validate: only digits in each part, at least one digit total.
  if (intRaw.length > 0 && !ALL_DIGITS.test(intRaw)) return undefined;
  if (fracRaw.length > 0 && !ALL_DIGITS.test(fracRaw)) return undefined;
  if (intRaw.length === 0 && fracRaw.length === 0) return undefined;
  // Strip leading zeros from the integer part (keep magnitude exact).
  let int = intRaw.replace(/^0+/, '');
  if (int === '') int = ''; // canonical zero integer part is empty string
  return { neg, int, frac: fracRaw };
}

/** True when a parts value represents exactly zero. */
function isZeroParts(p: DecimalParts): boolean {
  return p.int === '' && /^0*$/.test(p.frac);
}

/**
 * Compare two well-formed decimal strings by magnitude/sign WITHOUT converting
 * to a native number. Returns -1, 0, or 1 (a < b, a == b, a > b).
 * `undefined` parts (malformed) are treated as equal-to-self no-ops by callers;
 * callers always pass well-formed strings here.
 */
function compareDecimalStrings(a: string, b: string): number {
  const pa = decimalParts(a);
  const pb = decimalParts(b);
  // Defensive: malformed bound or value collapses to "equal" (no constraint hit).
  if (!pa || !pb) return 0;
  const za = isZeroParts(pa);
  const zb = isZeroParts(pb);
  // Normalize signed-zero so -0 == 0.
  const na = za ? false : pa.neg;
  const nb = zb ? false : pb.neg;
  if (na !== nb) return na ? -1 : 1; // negative < positive
  const mag = compareMagnitude(pa, pb);
  return na ? -mag : mag; // both negative → reverse magnitude ordering
}

/** Compare absolute magnitudes of two decimal parts. Returns -1/0/1. */
function compareMagnitude(a: DecimalParts, b: DecimalParts): number {
  // Integer parts are leading-zero-stripped: longer = larger.
  if (a.int.length !== b.int.length) {
    return a.int.length < b.int.length ? -1 : 1;
  }
  if (a.int !== b.int) {
    return a.int < b.int ? -1 : 1; // equal length → lexicographic == numeric
  }
  // Integer parts equal; compare fractions digit-by-digit, padding the shorter.
  const max = Math.max(a.frac.length, b.frac.length);
  for (let i = 0; i < max; i++) {
    const da = i < a.frac.length ? a.frac.charCodeAt(i) : 48; // '0'
    const db = i < b.frac.length ? b.frac.charCodeAt(i) : 48;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}

/** Number of fractional digits in a well-formed decimal string (0 when none). */
function fractionDigits(text: string): number {
  const dot = text.indexOf('.');
  if (dot === -1) return 0;
  return text.length - dot - 1;
}

/**
 * Pad a well-formed decimal string with trailing zeros up to `scale` fractional
 * digits (lossless, RFC §2.6). Never truncates. When `scale` is 0, drops a
 * trailing bare dot but otherwise leaves the fraction (over-scale is caught by
 * validation, not here). Returns the input unchanged on malformed text.
 */
function padToScale(text: string, scale: number): string {
  const dot = text.indexOf('.');
  const have = dot === -1 ? 0 : text.length - dot - 1;
  if (have >= scale) {
    // Already at/over scale: strip a trailing bare dot ("5." → "5") only.
    return dot !== -1 && have === 0 ? text.slice(0, dot) : text;
  }
  let base = text;
  if (dot === -1) base = text + '.';
  return base + '0'.repeat(scale - have);
}

/**
 * Canonicalize a well-formed signed integer/decimal STRING:
 *   - drop a redundant leading '+',
 *   - collapse '-0' / '0' / '0.0' style zeros' sign,
 *   - strip redundant integer leading zeros while preserving magnitude,
 *   - keep the fraction exactly as entered (scale padding is applied separately).
 * Returns the input unchanged when it is not well-formed.
 */
function canonicalDecimalString(text: string): string {
  const p = decimalParts(text);
  if (!p) return text;
  const intOut = p.int === '' ? '0' : p.int;
  const neg = isZeroParts(p) ? false : p.neg;
  const sign = neg ? '-' : '';
  return p.frac.length > 0 ? `${sign}${intOut}.${p.frac}` : `${sign}${intOut}`;
}

/* ------------------------------------------------------------------ *
 * Locale-aware VIEW formatting (RFC §2.5 view/canonical split, §3.8).
 * These helpers shape the human-facing view ONLY. They NEVER feed
 * canonical/serialize/normalize, which stay locale-independent (RFC §2.2).
 * ------------------------------------------------------------------ */

/** Apply thousands grouping to a run of integer digits (no sign, digits only). */
function groupIntegerDigits(digits: string, group: string): string {
  if (digits.length <= 3) return digits;
  let out = '';
  const first = digits.length % 3 || 3;
  out = digits.slice(0, first);
  for (let i = first; i < digits.length; i += 3) {
    out += group + digits.slice(i, i + 3);
  }
  return out;
}

/**
 * Format an EXACT numeric string for the view, applying locale grouping to the
 * integer part and the locale decimal separator to the fraction — preserving
 * every digit (RFC §2.6). NEVER routes through Number()/Intl, so arbitrary
 * magnitude/precision (int64, decimal) stays exact. Negative numbers and an
 * absent fractional part are handled. Returns the input unchanged if malformed.
 */
function formatExactString(text: string, sep: LocaleSeparators): string {
  const p = decimalParts(text);
  if (!p) return text;
  const intDigits = p.int === '' ? '0' : p.int;
  const neg = isZeroParts(p) ? false : p.neg;
  const sign = neg ? '-' : '';
  const grouped = groupIntegerDigits(intDigits, sep.group);
  return p.frac.length > 0 ? `${sign}${grouped}${sep.decimal}${p.frac}` : `${sign}${grouped}`;
}

/* Bound comparison for native-number types (safe range only). */
function numberBounds(
  value: number,
  constraints: Constraints,
): { errors: Issue[]; warnings: Issue[] } {
  const errors: Issue[] = [];
  if (constraints.min !== undefined) {
    const min = Number(constraints.min);
    if (!Number.isNaN(min) && value < min) {
      errors.push(issue('min', { min: constraints.min }));
    }
  }
  if (constraints.max !== undefined) {
    const max = Number(constraints.max);
    if (!Number.isNaN(max) && value > max) {
      errors.push(issue('max', { max: constraints.max }));
    }
  }
  return { errors, warnings: [] };
}

/* ------------------------------------------------------------------ *
 * string
 * ------------------------------------------------------------------ */

const STRING_CODES = ['invalid', 'min', 'max'] as const;

export const stringType: TypeDefinition<string> = {
  name: 'string',
  codes: STRING_CODES,
  defaultUse: 'input',

  filter(raw: string, _constraints: Constraints, _ctx: Context): string {
    // Strip control characters that can never be valid (keep all printable).
    let out = '';
    for (let i = 0; i < raw.length; i++) {
      const c = raw.charCodeAt(i);
      if (c >= 32 || c === 9) out += raw[i]; // allow tab + printable
    }
    return out;
  },

  parse(raw: string, _constraints: Constraints, _ctx: Context): ParseResult<string> {
    return { ok: true, value: raw };
  },

  validate(value: string, constraints: Constraints, _ctx: Context): ValidationResult {
    const errors: Issue[] = [];
    // For strings, magnitude bounds mean character length (resolved-type rule,
    // RFC §2.8 — string is scalar, not a collection, so min/max read as length).
    const len = value.length;
    if (constraints.min !== undefined) {
      const min = Number(constraints.min);
      if (!Number.isNaN(min) && len < min) errors.push(issue('min', { min: constraints.min }));
    }
    if (constraints.max !== undefined) {
      const max = Number(constraints.max);
      if (!Number.isNaN(max) && len > max) errors.push(issue('max', { max: constraints.max }));
    }
    return { errors, warnings: [] };
  },

  normalize(value: string, _constraints: Constraints, _ctx: Context): string {
    return value.trim();
  },

  serialize(value: string, _constraints: Constraints, _ctx: Context): unknown {
    return value;
  },

  deserialize(canonical: unknown, _ctx: Context): ParseResult<string> {
    if (typeof canonical !== 'string') return { ok: false, code: 'invalid' };
    return { ok: true, value: canonical };
  },

  view(value: string, _constraints: Constraints, _ctx: Context): unknown {
    return value;
  },
};

/* ------------------------------------------------------------------ *
 * bool
 * ------------------------------------------------------------------ */

const BOOL_CODES = ['invalid'] as const;
const BOOL_TRUE = /^(true|1|yes|on)$/i;
const BOOL_FALSE = /^(false|0|no|off)$/i;

export const boolType: TypeDefinition<boolean> = {
  name: 'bool',
  codes: BOOL_CODES,
  defaultUse: 'switch',
  pattern: /^(true|false|1|0|yes|no|on|off)$/i,

  filter(raw: string, _constraints: Constraints, _ctx: Context): string {
    // Bounded; keep alphanumerics only — no separators are ever valid.
    return raw.replace(/[^a-z0-9]/gi, '');
  },

  parse(raw: string, _constraints: Constraints, _ctx: Context): ParseResult<boolean> {
    if (BOOL_TRUE.test(raw)) return { ok: true, value: true };
    if (BOOL_FALSE.test(raw)) return { ok: true, value: false };
    return { ok: false, code: 'invalid' };
  },

  validate(_value: boolean, _constraints: Constraints, _ctx: Context): ValidationResult {
    return ok();
  },

  normalize(value: boolean, _constraints: Constraints, _ctx: Context): boolean {
    return value;
  },

  serialize(value: boolean, _constraints: Constraints, _ctx: Context): unknown {
    return value;
  },

  deserialize(canonical: unknown, _ctx: Context): ParseResult<boolean> {
    if (typeof canonical === 'boolean') return { ok: true, value: canonical };
    return { ok: false, code: 'invalid' };
  },

  view(value: boolean, _constraints: Constraints, _ctx: Context): unknown {
    return value;
  },
};

/* ------------------------------------------------------------------ *
 * int32 (T=number, safe range)
 * ------------------------------------------------------------------ */

const INT_CODES = ['invalid', 'min', 'max', 'step'] as const;
const INT_PATTERN = /^[+-]?\d+$/;

/** Shared step check for native-number integer/float types. */
function numberStep(value: number, constraints: Constraints): Issue[] {
  if (constraints.step === undefined) return [];
  const step = Number(constraints.step);
  if (Number.isNaN(step) || step === 0) return [];
  const base = constraints.min !== undefined ? Number(constraints.min) : 0;
  const offset = value - (Number.isNaN(base) ? 0 : base);
  // Tolerance-free for integers; for floats a tiny epsilon guards binary error.
  const q = offset / step;
  const rounded = Math.round(q);
  if (Math.abs(q - rounded) > 1e-9) return [issue('step', { step: constraints.step })];
  return [];
}

export const int32Type: TypeDefinition<number> = {
  name: 'int32',
  codes: INT_CODES,
  defaultUse: 'number',
  pattern: NUMERIC_FASTPATH,

  filter(raw: string, constraints: Constraints, ctx: Context): string {
    return filterNumeric(raw, false, constraints, ctx);
  },

  parse(raw: string, constraints: Constraints, ctx: Context): ParseResult<number> {
    const s = toCanonicalNumeric(raw, constraints, ctx);
    if (!INT_PATTERN.test(s)) return { ok: false, code: 'invalid' };
    const n = Number(s);
    if (!Number.isInteger(n) || !Number.isSafeInteger(n)) {
      return { ok: false, code: 'invalid' };
    }
    // int32 range guard.
    if (n < -2147483648 || n > 2147483647) return { ok: false, code: 'invalid' };
    return { ok: true, value: n };
  },

  validate(value: number, constraints: Constraints, _ctx: Context): ValidationResult {
    const { errors } = numberBounds(value, constraints);
    errors.push(...numberStep(value, constraints));
    return { errors, warnings: [] };
  },

  normalize(value: number, _constraints: Constraints, _ctx: Context): number {
    return value; // numeric value is already canonical (no leading zeros etc.)
  },

  serialize(value: number, _constraints: Constraints, _ctx: Context): unknown {
    return value;
  },

  deserialize(canonical: unknown, _ctx: Context): ParseResult<number> {
    if (typeof canonical === 'number' && Number.isInteger(canonical)) {
      return { ok: true, value: canonical };
    }
    if (typeof canonical === 'string' && INT_PATTERN.test(canonical)) {
      const n = Number(canonical);
      if (Number.isSafeInteger(n)) return { ok: true, value: n };
    }
    return { ok: false, code: 'invalid' };
  },

  view(value: number, _constraints: Constraints, ctx: Context): unknown {
    // Safe-range integer: locale grouping via Intl is precision-safe here.
    return new Intl.NumberFormat(ctx.locale, { maximumFractionDigits: 0 }).format(value);
  },
};

/* ------------------------------------------------------------------ *
 * int64 (T=string, string-encoded — fidelity beyond safe integer range)
 * ------------------------------------------------------------------ */

const INT64_CODES = ['invalid', 'min', 'max', 'step'] as const;
const INT64_PATTERN = /^[+-]?\d+$/;

export const int64Type: TypeDefinition<string> = {
  name: 'int64',
  codes: INT64_CODES,
  defaultUse: 'number',
  pattern: NUMERIC_FASTPATH,

  filter(raw: string, constraints: Constraints, ctx: Context): string {
    return filterNumeric(raw, false, constraints, ctx);
  },

  parse(raw: string, constraints: Constraints, ctx: Context): ParseResult<string> {
    const s = toCanonicalNumeric(raw, constraints, ctx);
    if (!INT64_PATTERN.test(s)) return { ok: false, code: 'invalid' };
    // Keep as string; canonicalize sign/leading-zeros in normalize.
    return { ok: true, value: canonicalDecimalString(s) };
  },

  validate(value: string, constraints: Constraints, _ctx: Context): ValidationResult {
    const errors: Issue[] = [];
    // String comparison — NEVER Number() (would lose precision beyond 2^53).
    if (constraints.min !== undefined && compareDecimalStrings(value, constraints.min) < 0) {
      errors.push(issue('min', { min: constraints.min }));
    }
    if (constraints.max !== undefined && compareDecimalStrings(value, constraints.max) > 0) {
      errors.push(issue('max', { max: constraints.max }));
    }
    // step: residue check via decimal-string arithmetic is out of scope; only a
    // safe-range step is honored, otherwise the constraint is skipped (no false
    // positive). This keeps int64 free of precision arithmetic (RFC §2.6).
    if (constraints.step !== undefined) {
      const step = Number(constraints.step);
      const v = Number(value);
      const base = constraints.min !== undefined ? Number(constraints.min) : 0;
      if (
        Number.isSafeInteger(step) &&
        step !== 0 &&
        Number.isSafeInteger(v) &&
        Number.isSafeInteger(base) &&
        (v - base) % step !== 0
      ) {
        errors.push(issue('step', { step: constraints.step }));
      }
    }
    return { errors, warnings: [] };
  },

  normalize(value: string, _constraints: Constraints, _ctx: Context): string {
    return canonicalDecimalString(value);
  },

  serialize(value: string, _constraints: Constraints, _ctx: Context): unknown {
    return canonicalDecimalString(value); // exact STRING projection
  },

  deserialize(canonical: unknown, _ctx: Context): ParseResult<string> {
    if (typeof canonical === 'string' && INT64_PATTERN.test(canonical)) {
      return { ok: true, value: canonicalDecimalString(canonical) };
    }
    // Accept a native integer only when it survives safe-integer round-trip.
    if (typeof canonical === 'number' && Number.isSafeInteger(canonical)) {
      return { ok: true, value: canonicalDecimalString(String(canonical)) };
    }
    return { ok: false, code: 'invalid' };
  },

  view(value: string, _constraints: Constraints, ctx: Context): unknown {
    // String-encoded: format from the EXACT string (never Number()/Intl) so
    // magnitude beyond 2^53 keeps every digit. Only separator glyphs come from
    // the locale (RFC §2.6).
    return formatExactString(canonicalDecimalString(value), localeSeparators(ctx.locale));
  },
};

/* ------------------------------------------------------------------ *
 * Shared float codec factory (T=number, safe range) for float32 / float64.
 * ------------------------------------------------------------------ */

const FLOAT_CODES = ['invalid', 'min', 'max', 'step', 'scale'] as const;
const FLOAT_PATTERN = /^[+-]?(\d+\.?\d*|\.\d+)$/;

function makeFloatType(name: string): TypeDefinition<number> {
  return {
    name,
    codes: FLOAT_CODES,
    defaultUse: 'number',
    pattern: NUMERIC_FASTPATH,

    filter(raw: string, constraints: Constraints, ctx: Context): string {
      return filterNumeric(raw, true, constraints, ctx);
    },

    parse(raw: string, constraints: Constraints, ctx: Context): ParseResult<number> {
      const s = toCanonicalNumeric(raw, constraints, ctx);
      if (!FLOAT_PATTERN.test(s)) return { ok: false, code: 'invalid' };
      const n = Number(s);
      if (!Number.isFinite(n)) return { ok: false, code: 'invalid' };
      return { ok: true, value: n };
    },

    validate(value: number, constraints: Constraints, _ctx: Context): ValidationResult {
      const { errors } = numberBounds(value, constraints);
      errors.push(...numberStep(value, constraints));
      // Over-scale is a validation ERROR, never rounded (RFC §2.6). Measure the
      // entered fractional width from the value's own decimal text.
      if (constraints.scale !== undefined) {
        const frac = fractionDigits(String(value));
        if (frac > constraints.scale) {
          errors.push(issue('scale', { scale: constraints.scale }));
        }
      }
      return { errors, warnings: [] };
    },

    normalize(value: number, _constraints: Constraints, _ctx: Context): number {
      // Padding is a textual concern; the internal number stays exact. Scale
      // padding is applied in view/serialize-adjacent string forms only.
      return value;
    },

    serialize(value: number, constraints: Constraints, _ctx: Context): unknown {
      // Safe-range floats project as native numbers. A declared scale governs
      // FORM only; a native number cannot carry trailing zeros, so canonical
      // stays numeric and the scale is reflected in the view projection.
      void constraints;
      return value;
    },

    deserialize(canonical: unknown, _ctx: Context): ParseResult<number> {
      if (typeof canonical === 'number' && Number.isFinite(canonical)) {
        return { ok: true, value: canonical };
      }
      if (typeof canonical === 'string' && FLOAT_PATTERN.test(canonical)) {
        const n = Number(canonical);
        if (Number.isFinite(n)) return { ok: true, value: n };
      }
      return { ok: false, code: 'invalid' };
    },

    view(value: number, constraints: Constraints, ctx: Context): unknown {
      // Safe-range float: locale grouping + decimal separator via Intl. A
      // declared scale fixes the fraction width so trailing zeros show in the
      // view (min == max fraction digits); canonical stays numeric (RFC §2.6).
      const options: Intl.NumberFormatOptions =
        constraints.scale !== undefined
          ? { minimumFractionDigits: constraints.scale, maximumFractionDigits: constraints.scale }
          : {};
      return new Intl.NumberFormat(ctx.locale, options).format(value);
    },
  };
}

export const float32Type: TypeDefinition<number> = makeFloatType('float32');
export const float64Type: TypeDefinition<number> = makeFloatType('float64');

/* ------------------------------------------------------------------ *
 * decimal (T=string, string-encoded — arbitrary precision, no arithmetic)
 * ------------------------------------------------------------------ */

const DECIMAL_CODES = ['invalid', 'min', 'max', 'step', 'scale'] as const;
const DECIMAL_PATTERN = /^[+-]?(\d+\.?\d*|\.\d+)$/;

export const decimalType: TypeDefinition<string> = {
  name: 'decimal',
  codes: DECIMAL_CODES,
  defaultUse: 'number',
  pattern: NUMERIC_FASTPATH,

  filter(raw: string, constraints: Constraints, ctx: Context): string {
    return filterNumeric(raw, true, constraints, ctx);
  },

  parse(raw: string, constraints: Constraints, ctx: Context): ParseResult<string> {
    const s = toCanonicalNumeric(raw, constraints, ctx);
    if (!DECIMAL_PATTERN.test(s)) return { ok: false, code: 'invalid' };
    if (decimalParts(s) === undefined) return { ok: false, code: 'invalid' };
    // Keep exact magnitude/precision as a string (RFC §2.6).
    return { ok: true, value: canonicalDecimalString(s) };
  },

  validate(value: string, constraints: Constraints, _ctx: Context): ValidationResult {
    const errors: Issue[] = [];
    // Magnitude bounds via the exact string comparator — never Number().
    if (constraints.min !== undefined && compareDecimalStrings(value, constraints.min) < 0) {
      errors.push(issue('min', { min: constraints.min }));
    }
    if (constraints.max !== undefined && compareDecimalStrings(value, constraints.max) > 0) {
      errors.push(issue('max', { max: constraints.max }));
    }
    // Over-scale is an ERROR (RFC §2.6) — measured on the exact entered string,
    // never rounded.
    if (constraints.scale !== undefined && fractionDigits(value) > constraints.scale) {
      errors.push(issue('scale', { scale: constraints.scale }));
    }
    // step: honored only when both value and step fit the safe range; otherwise
    // skipped to avoid precision arithmetic (RFC §2.6) and false positives.
    if (constraints.step !== undefined) {
      const step = Number(constraints.step);
      const v = Number(value);
      const base = constraints.min !== undefined ? Number(constraints.min) : 0;
      if (
        Number.isFinite(step) &&
        step !== 0 &&
        Number.isFinite(v) &&
        Number.isFinite(base)
      ) {
        const q = (v - base) / step;
        if (Math.abs(q - Math.round(q)) > 1e-9) {
          errors.push(issue('step', { step: constraints.step }));
        }
      }
    }
    return { errors, warnings: [] };
  },

  normalize(value: string, constraints: Constraints, _ctx: Context): string {
    // Canonicalize sign/leading-zeros, then apply lossless scale padding.
    const canon = canonicalDecimalString(value);
    if (constraints.scale !== undefined) return padToScale(canon, constraints.scale);
    return canon;
  },

  serialize(value: string, constraints: Constraints, _ctx: Context): unknown {
    // Exact STRING projection, with author-determined scale padding (RFC §2.6).
    const canon = canonicalDecimalString(value);
    if (constraints.scale !== undefined) return padToScale(canon, constraints.scale);
    return canon;
  },

  deserialize(canonical: unknown, _ctx: Context): ParseResult<string> {
    if (typeof canonical === 'string' && DECIMAL_PATTERN.test(canonical)) {
      if (decimalParts(canonical) === undefined) return { ok: false, code: 'invalid' };
      return { ok: true, value: canonicalDecimalString(canonical) };
    }
    // A native number is accepted but only insofar as its string form is exact.
    if (typeof canonical === 'number' && Number.isFinite(canonical)) {
      return { ok: true, value: canonicalDecimalString(String(canonical)) };
    }
    return { ok: false, code: 'invalid' };
  },

  view(value: string, constraints: Constraints, ctx: Context): unknown {
    // String-encoded: pad to scale losslessly, then apply locale separators to
    // the EXACT string (never Number()/Intl) so arbitrary precision survives and
    // the scale-padded fraction is preserved digit-for-digit (RFC §2.6).
    const canon = canonicalDecimalString(value);
    const padded =
      constraints.scale !== undefined ? padToScale(canon, constraints.scale) : canon;
    return formatExactString(padded, localeSeparators(ctx.locale));
  },
};

/* ------------------------------------------------------------------ *
 * Aggregate registration list (RFC §2.11).
 * ------------------------------------------------------------------ */

export const primitiveTypes: TypeDefinition[] = [
  stringType,
  boolType,
  int32Type,
  int64Type,
  float32Type,
  float64Type,
  decimalType,
];
