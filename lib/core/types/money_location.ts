/**
 * MONETARY + LOCATION TYPES — codecs for money and place-bound meanings.
 *
 * Each export is a `TypeDefinition` whose canonical projection conforms to the
 * recognized global standard for its meaning (RFC §2.4, §7): an exact monetary
 * amount paired with an ISO 4217 currency code, an ISO 3166-1 alpha-2 country
 * code, and an E.164 telephone number. The codec shape mirrors the primitives
 * and semantic modules:
 *
 *   filter   → light cleanup; never parses.
 *   parse    → assume a non-empty raw (the engine handles empty per §4.1);
 *              return { ok:false, code:'invalid' } on a malformed instance.
 *   validate → type-intrinsic semantic validity plus the author-declared
 *              numeric constraints owned by the type (scale/min/max for money).
 *              Collect ALL issues, never short-circuit (RFC §4.11). Only stable
 *              `codes` are emitted.
 *   normalize→ collapse equivalent inputs to the single standardized internal
 *              form (RFC §4.4).
 *   serialize→ canonical, machine-safe, locale-independent projection.
 *   deserialize → inverse of serialize; round-trip idempotent so that
 *              serialize(deserialize(canonical)) === canonical (RFC §3.1).
 *   view     → human projection; locale/context dependent.
 *   project  → extended projections beyond view/canonical (RFC §2.5, §3.3).
 *
 * NUMERIC FIDELITY (RFC §2.6): the monetary amount is carried as an EXACT
 * STRING for both the internal value and the canonical projection. It is never
 * round-tripped through a native `number` for canonical truth; `Number()` is
 * used ONLY to feed the locale view formatter (display only).
 *
 * Purity (RFC §3.8): no DOM, no framework, no ambient reads. The environment is
 * consulted ONLY through the passed `ctx`. `Intl` is used purely as a formatting
 * utility for the view projection, always fed `ctx.locale`.
 */

import type {
  TypeDefinition,
  Context,
  Constraints,
  ParseResult,
  ValidationResult,
  Issue,
} from '../contracts';
import {
  filterNumeric,
  toCanonicalNumeric,
  NUMERIC_FASTPATH,
} from './numeric_locale';

/* ------------------------------------------------------------------ *
 * Shared helpers
 * ------------------------------------------------------------------ */

/** Build a ValidationResult from already-collected lists. */
function result(errors: Issue[], warnings: Issue[]): ValidationResult {
  return { errors, warnings };
}

/** Issue constructor (omits an empty params bag). */
function issue(code: string, params?: Record<string, unknown>): Issue {
  return params ? { code, params } : { code };
}

/** Failure shorthand for parse/deserialize. */
function fail(code: string): { ok: false; code: string } {
  return { ok: false, code };
}

/* ================================================================== *
 * Exact decimal helpers (string-encoded, no precision arithmetic).
 * Local to this module so the type stays self-contained (RFC §2.6, §2.16).
 * ================================================================== */

const ALL_DIGITS = /^[0-9]+$/;
const DECIMAL_PATTERN = /^[+-]?(\d+\.?\d*|\.\d+)$/;

interface DecimalParts {
  neg: boolean;
  int: string; // leading-zero-stripped integer digits ("" means zero)
  frac: string; // fractional digits, exactly as entered
}

/**
 * Parse a textual signed decimal into canonical parts WITHOUT precision loss.
 * Returns undefined when the text is not a well-formed decimal.
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
  if (intRaw.length > 0 && !ALL_DIGITS.test(intRaw)) return undefined;
  if (fracRaw.length > 0 && !ALL_DIGITS.test(fracRaw)) return undefined;
  if (intRaw.length === 0 && fracRaw.length === 0) return undefined;
  const int = intRaw.replace(/^0+/, '');
  return { neg, int, frac: fracRaw };
}

/** True when a parts value represents exactly zero. */
function isZeroParts(p: DecimalParts): boolean {
  return p.int === '' && /^0*$/.test(p.frac);
}

/** Compare absolute magnitudes of two decimal parts. Returns -1/0/1. */
function compareMagnitude(a: DecimalParts, b: DecimalParts): number {
  if (a.int.length !== b.int.length) {
    return a.int.length < b.int.length ? -1 : 1;
  }
  if (a.int !== b.int) {
    return a.int < b.int ? -1 : 1; // equal length → lexicographic == numeric
  }
  const max = Math.max(a.frac.length, b.frac.length);
  for (let i = 0; i < max; i++) {
    const da = i < a.frac.length ? a.frac.charCodeAt(i) : 48; // '0'
    const db = i < b.frac.length ? b.frac.charCodeAt(i) : 48;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}

/**
 * Compare two well-formed decimal strings by magnitude/sign WITHOUT converting
 * to a native number. Returns -1, 0, or 1. Malformed operands collapse to 0
 * (no constraint hit) so a bad bound never spuriously fails a valid value.
 */
function compareDecimalStrings(a: string, b: string): number {
  const pa = decimalParts(a);
  const pb = decimalParts(b);
  if (!pa || !pb) return 0;
  const na = isZeroParts(pa) ? false : pa.neg;
  const nb = isZeroParts(pb) ? false : pb.neg;
  if (na !== nb) return na ? -1 : 1; // negative < positive
  const mag = compareMagnitude(pa, pb);
  return na ? -mag : mag; // both negative → reverse magnitude ordering
}

/** Number of fractional digits in a well-formed decimal string (0 when none). */
function fractionDigits(text: string): number {
  const dot = text.indexOf('.');
  if (dot === -1) return 0;
  return text.length - dot - 1;
}

/**
 * Pad a well-formed decimal string with trailing zeros up to `scale` fractional
 * digits (lossless, RFC §2.6). Never truncates (over-scale is a validation
 * error, caught elsewhere). Returns the input unchanged on malformed text.
 */
function padToScale(text: string, scale: number): string {
  const dot = text.indexOf('.');
  const have = dot === -1 ? 0 : text.length - dot - 1;
  if (have >= scale) {
    return dot !== -1 && have === 0 ? text.slice(0, dot) : text;
  }
  const base = dot === -1 ? text + '.' : text;
  return base + '0'.repeat(scale - have);
}

/**
 * Canonicalize a well-formed signed integer/decimal STRING: drop a redundant
 * '+', collapse signed zero, strip integer leading zeros while preserving
 * magnitude, keep the fraction exactly as entered (scale padding is separate).
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

/* ================================================================== *
 * money — exact amount (RFC §2.6 string-encoded) + ISO 4217 currency.
 *
 * Internal value T is the EXACT amount string. The currency is read from
 * constraints (default 'USD'), uppercased; it is not part of T but is folded
 * into the canonical object and projections.
 *
 * Canonical projection shape: { amount: string, currency: string } — machine-
 * safe, locale-independent, exact amount string (no rounding, ever).
 * ================================================================== */

const MONEY_CODES = ['invalid', 'min', 'max', 'scale'] as const;
const DEFAULT_CURRENCY = 'USD';
const DEFAULT_MONEY_SCALE = 2;

/** Resolve the effective currency code for a money field (uppercased). */
function moneyCurrency(constraints: Constraints): string {
  const raw = constraints.currency;
  const code = raw && raw.trim().length > 0 ? raw.trim() : DEFAULT_CURRENCY;
  return code.toUpperCase();
}

/** Effective fractional scale for a money field (default 2). */
function moneyScale(constraints: Constraints): number {
  return constraints.scale !== undefined ? constraints.scale : DEFAULT_MONEY_SCALE;
}

/** Canonical money object (machine-safe, exact amount string). */
interface MoneyCanonical {
  amount: string;
  currency: string;
}

export const moneyType: TypeDefinition<string> = {
  name: 'money',
  codes: MONEY_CODES,
  defaultUse: 'number',
  pattern: NUMERIC_FASTPATH,

  filter(raw: string, constraints: Constraints, ctx: Context): string {
    // Locale-aware (or dot-decimal when the author opts in): keep digits, one
    // sign, the decimal + group separators.
    return filterNumeric(raw, true, constraints, ctx);
  },

  parse(raw: string, constraints: Constraints, ctx: Context): ParseResult<string> {
    // Canonicalize the locale/dot form to a '.'-decimal, group-free string.
    const s = toCanonicalNumeric(raw, constraints, ctx);
    if (!DECIMAL_PATTERN.test(s)) return fail('invalid');
    if (decimalParts(s) === undefined) return fail('invalid');
    // Keep the EXACT magnitude/precision as a string (RFC §2.6) — never Number().
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
    // Over-scale is an ERROR (RFC §2.6) measured on the exact entered string,
    // never rounded. Under-scale pads losslessly at normalize/serialize time.
    const scale = moneyScale(constraints);
    if (fractionDigits(value) > scale) {
      errors.push(issue('scale', { scale }));
    }
    return result(errors, []);
  },

  normalize(value: string, constraints: Constraints, _ctx: Context): string {
    // Canonicalize sign/leading-zeros, then apply lossless scale padding.
    return padToScale(canonicalDecimalString(value), moneyScale(constraints));
  },

  serialize(value: string, constraints: Constraints, _ctx: Context): unknown {
    // Canonical = exact amount string (scale-padded) + uppercased currency code.
    const amount = padToScale(canonicalDecimalString(value), moneyScale(constraints));
    const canonical: MoneyCanonical = {
      amount,
      currency: moneyCurrency(constraints),
    };
    return canonical;
  },

  deserialize(canonical: unknown, _ctx: Context): ParseResult<string> {
    // Accept the canonical object, or a bare amount string.
    let amount: unknown;
    if (typeof canonical === 'string') {
      amount = canonical;
    } else if (canonical !== null && typeof canonical === 'object') {
      amount = (canonical as { amount?: unknown }).amount;
    }
    if (typeof amount !== 'string' || !DECIMAL_PATTERN.test(amount)) {
      return fail('invalid');
    }
    if (decimalParts(amount) === undefined) return fail('invalid');
    return { ok: true, value: canonicalDecimalString(amount) };
  },

  view(value: string, constraints: Constraints, ctx: Context): unknown {
    const amount = padToScale(canonicalDecimalString(value), moneyScale(constraints));
    const currency = moneyCurrency(constraints);
    try {
      // Display only: Number() round-trip is acceptable here (the canonical
      // projection above stays an EXACT string); locale-formatted currency.
      return new Intl.NumberFormat(ctx.locale, {
        style: 'currency',
        currency,
      }).format(Number(amount));
    } catch {
      // Unknown currency / unsupported locale → safe, locale-independent fallback.
      return `${amount} ${currency}`;
    }
  },

  project(value: string, constraints: Constraints, ctx: Context): Record<string, unknown> {
    const amount = padToScale(canonicalDecimalString(value), moneyScale(constraints));
    const currency = moneyCurrency(constraints);
    return {
      amount,
      currency,
      formatted: this.view(value, constraints, ctx),
    };
  },
};

/* ================================================================== *
 * country — ISO 3166-1 alpha-2. Canonical: UPPERCASE two ASCII letters.
 * Well-formed but unrecognized codes pass with an 'unknown' WARNING.
 * ================================================================== */

const COUNTRY_CODES = ['invalid', 'unknown'] as const;
const COUNTRY_SHAPE = /^[A-Za-z]{2}$/;

/** ~30 common ISO 3166-1 alpha-2 codes for the advisory recognition set. */
const KNOWN_COUNTRIES: ReadonlySet<string> = new Set([
  'US', 'CA', 'MX', 'BR', 'AR', 'GB', 'IE', 'FR', 'DE', 'ES',
  'IT', 'PT', 'NL', 'BE', 'CH', 'AT', 'SE', 'NO', 'DK', 'FI',
  'PL', 'RU', 'CN', 'JP', 'KR', 'IN', 'AU', 'NZ', 'ZA', 'SG',
]);

export const countryType: TypeDefinition<string> = {
  name: 'country',
  codes: COUNTRY_CODES,
  defaultUse: 'select',
  pattern: COUNTRY_SHAPE,

  filter(raw: string, _constraints: Constraints, _ctx: Context): string {
    return raw.trim();
  },

  parse(raw: string, _constraints: Constraints, _ctx: Context): ParseResult<string> {
    // Cheap structural gate; full shape is asserted in validate().
    if (raw.trim().length !== 2) return fail('invalid');
    return { ok: true, value: raw.trim() };
  },

  validate(value: string, _c: Constraints, _ctx: Context): ValidationResult {
    const errors: Issue[] = [];
    const warnings: Issue[] = [];
    const up = value.trim().toUpperCase();
    if (!COUNTRY_SHAPE.test(up)) {
      errors.push(issue('invalid'));
    } else if (!KNOWN_COUNTRIES.has(up)) {
      // Well-formed but not in the embedded set → non-blocking advisory.
      warnings.push(issue('unknown', { code: up }));
    }
    return result(errors, warnings);
  },

  normalize(value: string, _c: Constraints, _ctx: Context): string {
    return value.trim().toUpperCase();
  },

  serialize(value: string, c: Constraints, ctx: Context): unknown {
    return this.normalize(value, c, ctx);
  },

  deserialize(canonical: unknown, _ctx: Context): ParseResult<string> {
    if (typeof canonical !== 'string') return fail('invalid');
    const up = canonical.trim().toUpperCase();
    if (!COUNTRY_SHAPE.test(up)) return fail('invalid');
    return { ok: true, value: up };
  },

  view(value: string, _c: Constraints, ctx: Context): unknown {
    const code = value.trim().toUpperCase();
    try {
      const dn = new Intl.DisplayNames(ctx.locale, { type: 'region' });
      const name = dn.of(code);
      return name && name !== code ? name : code;
    } catch {
      return code; // localized names unavailable → fall back to the code
    }
  },

  project(value: string, _c: Constraints, ctx: Context): Record<string, unknown> {
    const code = value.trim().toUpperCase();
    return { code, name: this.view(value, _c, ctx) };
  },
};

/* ================================================================== *
 * phone — E.164 best-effort. Canonical: '+' followed by 7-15 digits.
 * Strips spaces/dashes/parens; rejects anything else.
 * ================================================================== */

const PHONE_CODES = ['invalid'] as const;
const E164 = /^\+[1-9]\d{6,14}$/;

/**
 * Strip common grouping characters (spaces, dashes, dots, parens) and a leading
 * 'plus' rendered literally, leaving a candidate E.164 string. Any other
 * character makes the result non-conformant and is preserved so validate fails.
 */
function stripPhone(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === ' ' || ch === '-' || ch === '.' || ch === '(' || ch === ')') {
      continue; // drop grouping separators
    }
    out += ch;
  }
  return out;
}

export const phoneType: TypeDefinition<string> = {
  name: 'phone',
  codes: PHONE_CODES,
  defaultUse: 'input',
  pattern: /^\+?[0-9]*$/,

  filter(raw: string, _constraints: Constraints, _ctx: Context): string {
    // E.164 (ITU-T) permits ONLY a leading '+' and digits. Strip everything
    // else (spaces, dashes, parens, dots, letters) live, so the control never
    // holds a character the standard disallows.
    let out = '';
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      const c = raw.charCodeAt(i);
      if (c >= 48 && c <= 57) {
        out += ch; // digit
      } else if (ch === '+' && out.length === 0) {
        out += ch; // single leading plus
      }
      // everything else dropped
    }
    return out;
  },

  parse(raw: string, _constraints: Constraints, _ctx: Context): ParseResult<string> {
    const stripped = stripPhone(raw.trim());
    if (stripped.length === 0) return fail('invalid');
    return { ok: true, value: stripped };
  },

  validate(value: string, _c: Constraints, _ctx: Context): ValidationResult {
    const errors: Issue[] = [];
    if (!E164.test(stripPhone(value))) errors.push(issue('invalid'));
    return result(errors, []);
  },

  normalize(value: string, _c: Constraints, _ctx: Context): string {
    return stripPhone(value);
  },

  serialize(value: string, c: Constraints, ctx: Context): unknown {
    return this.normalize(value, c, ctx);
  },

  deserialize(canonical: unknown, _ctx: Context): ParseResult<string> {
    if (typeof canonical !== 'string') return fail('invalid');
    const stripped = stripPhone(canonical.trim());
    if (!E164.test(stripped)) return fail('invalid');
    return { ok: true, value: stripped };
  },

  view(value: string, _c: Constraints, _ctx: Context): unknown {
    // Return the canonical E.164 (simple, locale-independent grouping).
    return stripPhone(value);
  },

  project(value: string, _c: Constraints, _ctx: Context): Record<string, unknown> {
    return { e164: stripPhone(value) };
  },
};

/* ------------------------------------------------------------------ *
 * Registry bundle
 * ------------------------------------------------------------------ */

export const moneyLocationTypes: TypeDefinition[] = [
  moneyType,
  countryType,
  phoneType,
];
