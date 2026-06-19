/**
 * NUMERIC LOCALE HELPERS — locale-driven separators for numeric input.
 *
 * Shared by the primitive numeric codecs and the money codec so decimal/group
 * separators follow the active locale (RFC §2.2 locale-aware input): the parsed
 * value and canonical output stay locale-INDEPENDENT (RFC §3.8) while the human
 * may type in their locale's form — `1,234.5` in en-US, `1.234,5` in de-DE.
 *
 * Pure: the environment is read ONLY via the passed Context (the locale tag).
 */

import type { Context, Constraints } from '../contracts';

export interface LocaleSeparators {
  group: string;
  decimal: string;
}

/**
 * Resolve the separators to use for a field: the author's dot-decimal override
 * (`.`=decimal, `,`=group) when `constraints.dotDecimal` is set, otherwise the
 * active locale's separators.
 */
export function numericSeparators(
  constraints: Constraints,
  ctx: Context,
): LocaleSeparators {
  if (constraints.dotDecimal) return { group: ',', decimal: '.' };
  return localeSeparators(ctx.locale);
}

/**
 * Read the locale's group + decimal separator glyphs from Intl using a fixed
 * probe number (no payload is routed through Intl, so precision is never at
 * risk). Falls back to the invariant "," / "." pair on an unsupported locale.
 */
export function localeSeparators(locale: string): LocaleSeparators {
  let group = ',';
  let decimal = '.';
  try {
    const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
    for (const part of parts) {
      if (part.type === 'group') group = part.value;
      else if (part.type === 'decimal') decimal = part.value;
    }
  } catch {
    // unsupported/invalid locale → keep invariant separators (still locale-safe)
  }
  return { group, decimal };
}

/**
 * Permissive pipeline fast-path (RFC §2.2): rejects characters that can never be
 * numeric (letters) but tolerates digits, sign, dot, comma, and space-family /
 * apostrophe group glyphs. Strict validation runs in parse on the canonicalized
 * value, so this never short-circuits valid locale-formatted input.
 */
export const NUMERIC_FASTPATH = /^[+-]?[\d.,\s']*$/;

/**
 * Filter raw numeric input for the active locale: keep digits, one leading sign,
 * (when allowed) one decimal separator, and group separators (kept for display).
 * Everything else — notably letters — is dropped, so a widget can mask live.
 */
export function filterNumeric(
  raw: string,
  allowFraction: boolean,
  constraints: Constraints,
  ctx: Context,
): string {
  const { group, decimal } = numericSeparators(constraints, ctx);
  let out = '';
  let seenSign = false;
  let seenDecimal = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    const c = raw.charCodeAt(i);
    if (c >= 48 && c <= 57) {
      out += ch; // 0-9
    } else if ((ch === '+' || ch === '-') && out.length === 0 && !seenSign) {
      seenSign = true;
      out += ch; // single leading sign
    } else if (allowFraction && ch === decimal && !seenDecimal) {
      seenDecimal = true;
      out += ch; // single locale decimal separator
    } else if (ch === group) {
      out += ch; // locale group separator kept for display
    }
    // everything else dropped
  }
  return out;
}

/**
 * Convert locale-formatted numeric text to the canonical, locale-independent
 * form: remove group separators and replace the locale decimal separator with
 * '.'. The result is what the strict numeric patterns in parse validate.
 */
export function toCanonicalNumeric(
  raw: string,
  constraints: Constraints,
  ctx: Context,
): string {
  const { group, decimal } = numericSeparators(constraints, ctx);
  let s = raw;
  if (group) s = s.split(group).join('');
  if (decimal && decimal !== '.') s = s.split(decimal).join('.');
  return s;
}
