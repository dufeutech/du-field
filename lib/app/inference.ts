/**
 * CONVENTION-OVER-CONFIGURATION INFERENCE (RFC §2.12, §4.7).
 *
 * Pure, deterministic heuristic tiers used by the field layer to fill in
 * missing metadata. This module supplies ONLY the heuristics; the field layer
 * applies the precedence chain (explicit > shape/value > name heuristic >
 * generic default — §4.7). Every function is a pure function of its inputs:
 * same input always yields the same output, with no ambient reads.
 */

import type { Registry } from '../core/contracts';

/* ------------------------------------------------------------------ *
 * Internal helpers — pure string canonicalization.
 * ------------------------------------------------------------------ */

/** Lower-case and strip every non-alphanumeric character. */
function canon(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/* ------------------------------------------------------------------ *
 * Type inference (name-based heuristic tier of §4.7).
 * ------------------------------------------------------------------ */

/**
 * Infer a registry type name from a field's machine name.
 *
 * Matching is case-insensitive and ignores separators (we compare against a
 * canonicalized form). Ordering is fixed so the result is deterministic; the
 * first matching convention wins. Falls back to the generic default 'string'.
 */
export function inferType(name: string): string {
  const lower = name.toLowerCase();
  const c = canon(name);

  // datetime — temporal moments with time-of-day.
  if (
    lower.endsWith('_at') ||
    c.includes('created') ||
    c.includes('updated') ||
    c.includes('timestamp') ||
    c.includes('datetime')
  ) {
    return 'datetime';
  }

  // date — calendar dates without time.
  if (
    c === 'date' ||
    c === 'dob' ||
    c === 'birthday' ||
    lower.endsWith('_date') ||
    c.includes('birthday')
  ) {
    return 'date';
  }

  // time — zoneless time-of-day (HH:MM:SS). Checked AFTER datetime/timestamp
  // (already returned above) and excludes 'timezone' (ends in 'zone', not 'time').
  if (c === 'time' || c.endsWith('time') || lower.endsWith('_time')) {
    return 'time';
  }

  // email — `email` and the separated `e_mail` spelling.
  if (c.includes('email') || lower.includes('e_mail')) {
    return 'email';
  }

  // uuid — conservative: only uuid/guid/*_uuid resolve to a unique identifier.
  if (c === 'uuid' || c === 'guid' || c.includes('uuid') || c.includes('guid')) {
    return 'uuid';
  }

  // url / web address
  if (
    c.includes('url') ||
    c.includes('link') ||
    c.includes('website') ||
    c.includes('uri')
  ) {
    return 'url';
  }

  // network addresses — ipv6 checked before the broader ip match.
  if (c.includes('ipv6')) {
    return 'ipv6';
  }
  if (c.includes('ipv4') || c.includes('ipaddress') || c.includes('ip')) {
    return 'ipv4';
  }

  // decimal — money-shaped magnitudes.
  if (
    c.includes('price') ||
    c.includes('amount') ||
    c.includes('cost') ||
    c.includes('total') ||
    c.includes('balance') ||
    c.includes('salary')
  ) {
    return 'decimal';
  }

  // int32 — counts and quantities.
  if (
    c.includes('age') ||
    c.includes('count') ||
    c.includes('qty') ||
    c.includes('quantity') ||
    c.includes('number') ||
    c.includes('num') ||
    lower.endsWith('_count')
  ) {
    return 'int32';
  }

  // currency / language / timezone — standardized code-bearing meanings.
  if (c.includes('currency')) {
    return 'currency';
  }
  if (c.includes('language') || c.includes('locale') || c.includes('lang')) {
    return 'language';
  }
  if (c.includes('timezone') || c.includes('tz')) {
    return 'timezone';
  }

  // duration
  if (c.includes('duration')) {
    return 'duration';
  }

  // phone — telephone numbers (E.164).
  if (c.includes('phone') || c.includes('mobile')) {
    return 'phone';
  }

  // country / location code.
  if (c.includes('country') || c.includes('nation')) {
    return 'country';
  }

  // bool — flags and predicates.
  if (
    c.includes('enabled') ||
    c.includes('active') ||
    lower.includes('is_') ||
    lower.includes('has_') ||
    c.startsWith('is') ||
    c.startsWith('has')
  ) {
    return 'bool';
  }

  // generic default (§4.7).
  return 'string';
}

/* ------------------------------------------------------------------ *
 * Use inference (§2.12 — interaction-style from resolved type).
 * ------------------------------------------------------------------ */

/**
 * Infer the interaction style for a resolved type by reading the type's
 * declared `defaultUse` from the registry. An unregistered type falls back to
 * the generic 'input' style (§4.8 — defined safe default, never throws).
 */
export function inferUse(typeName: string, registry: Registry): string {
  const def = registry.getType(typeName);
  return def ? def.defaultUse : 'input';
}

/* ------------------------------------------------------------------ *
 * Text inference (§2.12 — humanize a machine name into a default label).
 * ------------------------------------------------------------------ */

/**
 * Convert a machine name to a Title-Cased label. Splits on `_`, `-`, spaces,
 * and camelCase / digit boundaries, then Title-Cases each word.
 *
 *   created_at -> "Created At"
 *   firstName  -> "First Name"
 */
export function humanize(name: string): string {
  const words = name
    // insert a space at lower→Upper camelCase boundaries
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    // insert a space at letter→digit and digit→letter boundaries
    .replace(/([A-Za-z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([A-Za-z])/g, '$1 $2')
    // split on separators and whitespace
    .split(/[\s_-]+/)
    .filter((word) => word.length > 0);

  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Fallback label key the runtime uses when no dictionary entry exists.
 * Equal to the humanized name (§2.12, §2.13 fallback chain).
 */
export function inferLabelKey(name: string): string {
  return humanize(name);
}
