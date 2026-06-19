/**
 * SEMANTIC TYPES — codecs for governed, standard-conformant meanings.
 *
 * Each export is a `TypeDefinition` whose canonical projection conforms to the
 * recognized global standard for its meaning (RFC §2.4, §7). The shape of every
 * codec mirrors the primitives module:
 *
 *   filter   → light cleanup (trim); never parses.
 *   parse    → assume a non-empty raw (the engine handles empty per §4.1);
 *              return { ok:false, code:'invalid' } on a malformed instance.
 *   validate → type-intrinsic semantic validity only; NOT required / choices /
 *              match (the engine owns those). Collect ALL issues, never
 *              short-circuit (RFC §4.11). Only stable `codes` are emitted.
 *   normalize→ collapse equivalent inputs to the single standardized internal
 *              form (RFC §4.4).
 *   serialize→ canonical, machine-safe, locale-independent projection. A string
 *              for every type except `json`, whose canonical may be any value.
 *   deserialize → inverse of serialize; round-trip idempotent so that
 *              serialize(deserialize(canonical)) === canonical (RFC §3.1).
 *   view     → human projection; locale/context dependent for time types.
 *
 * Purity (RFC §3.8, rules §3): no DOM, no framework, no ambient reads. The
 * environment is consulted ONLY through the passed `ctx`. `Intl` is used purely
 * as a math/formatting utility, always fed `ctx.timeZone` / `ctx.locale`, never
 * the ambient locale or `Date.now`.
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
 * Shared helpers
 * ------------------------------------------------------------------ */

/** A clean, allocation-light "no issues" result. */
function ok(): ValidationResult {
  return { errors: [], warnings: [] };
}

/** Build a ValidationResult from already-collected lists. */
function result(errors: Issue[], warnings: Issue[]): ValidationResult {
  return { errors, warnings };
}

/** Failure shorthand for parse/deserialize. */
function fail(code: string): { ok: false; code: string } {
  return { ok: false, code };
}

const ASCII_DIGITS = '0123456789';

function isDigit(ch: string): boolean {
  return ASCII_DIGITS.indexOf(ch) !== -1;
}

/* ================================================================== *
 * email — RFC 5322 (practical) / RFC 6531 host casing
 * Canonical: trimmed; local part case preserved; domain lowercased.
 * ================================================================== */

// Practical, bounded shape: one "@", a non-empty local part with no spaces,
// and a dotted domain with at least one dot and ASCII letters/digits/hyphen.
const EMAIL_PATTERN =
  /^[^\s@]{1,64}@(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/;

export const emailType: TypeDefinition<string> = {
  name: 'email',
  codes: ['invalid', 'shape'] as const,
  defaultUse: 'input',
  pattern: EMAIL_PATTERN,

  filter(raw: string, _constraints: Constraints, _ctx: Context): string {
    return raw.trim();
  },

  parse(raw: string, _constraints: Constraints, _ctx: Context): ParseResult<string> {
    if (raw.indexOf('@') === -1) return fail('invalid');
    return { ok: true, value: raw };
  },

  validate(value: string, _c: Constraints, _ctx: Context): ValidationResult {
    const errors: Issue[] = [];
    if (!EMAIL_PATTERN.test(value)) errors.push({ code: 'shape' });
    return result(errors, []);
  },

  normalize(value: string, _c: Constraints, _ctx: Context): string {
    const at = value.lastIndexOf('@');
    if (at === -1) return value.trim();
    const local = value.slice(0, at).trim();
    const domain = value.slice(at + 1).trim().toLowerCase();
    return `${local}@${domain}`;
  },

  serialize(value: string, c: Constraints, ctx: Context): string {
    return this.normalize(value, c, ctx);
  },

  deserialize(canonical: unknown, _ctx: Context): ParseResult<string> {
    if (typeof canonical !== 'string') return fail('invalid');
    const at = canonical.lastIndexOf('@');
    if (at === -1) return fail('invalid');
    const local = canonical.slice(0, at).trim();
    const domain = canonical.slice(at + 1).trim().toLowerCase();
    return { ok: true, value: `${local}@${domain}` };
  },

  view(value: string, c: Constraints, ctx: Context): unknown {
    return this.normalize(value, c, ctx);
  },
};

/* ================================================================== *
 * uuid — RFC 9562 canonical lowercase, 8-4-4-4-12 hex.
 * ================================================================== */

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const uuidType: TypeDefinition<string> = {
  name: 'uuid',
  codes: ['invalid', 'shape'] as const,
  defaultUse: 'input',
  pattern: UUID_PATTERN,

  filter(raw: string, _constraints: Constraints, _ctx: Context): string {
    return raw.trim();
  },

  parse(raw: string, _constraints: Constraints, _ctx: Context): ParseResult<string> {
    // Cheap structural check; full validity is asserted in validate().
    if (raw.length !== 36) return fail('invalid');
    return { ok: true, value: raw };
  },

  validate(value: string, _c: Constraints, _ctx: Context): ValidationResult {
    const errors: Issue[] = [];
    if (!UUID_PATTERN.test(value)) errors.push({ code: 'shape' });
    return result(errors, []);
  },

  normalize(value: string, _c: Constraints, _ctx: Context): string {
    return value.trim().toLowerCase();
  },

  serialize(value: string, c: Constraints, ctx: Context): string {
    return this.normalize(value, c, ctx);
  },

  deserialize(canonical: unknown, _ctx: Context): ParseResult<string> {
    if (typeof canonical !== 'string') return fail('invalid');
    const v = canonical.trim().toLowerCase();
    if (!UUID_PATTERN.test(v)) return fail('invalid');
    return { ok: true, value: v };
  },

  view(value: string, c: Constraints, ctx: Context): unknown {
    return this.normalize(value, c, ctx);
  },
};

/* ================================================================== *
 * url — RFC 3986. Require scheme + host; lowercase scheme/host.
 * Internal value is the canonical URL string.
 * ================================================================== */

interface ParsedUrl {
  scheme: string;
  host: string;
  rest: string; // port + path + query + fragment, preserved as-is
}

/**
 * Bounded, hand-rolled split into scheme / authority-host / remainder.
 * We avoid the host `URL` parser to keep canonicalization explicit and
 * deterministic across hosts. Returns null when scheme or host is missing.
 */
function splitUrl(input: string): ParsedUrl | null {
  const value = input.trim();
  const schemeEnd = value.indexOf('://');
  if (schemeEnd <= 0) return null;
  const scheme = value.slice(0, schemeEnd);
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*$/.test(scheme)) return null;

  const afterScheme = value.slice(schemeEnd + 3);
  if (afterScheme.length === 0) return null;

  // Authority ends at the first '/', '?' or '#'.
  let authEnd = afterScheme.length;
  for (let i = 0; i < afterScheme.length; i++) {
    const ch = afterScheme[i];
    if (ch === '/' || ch === '?' || ch === '#') {
      authEnd = i;
      break;
    }
  }
  const authority = afterScheme.slice(0, authEnd);
  const rest = afterScheme.slice(authEnd);
  if (authority.length === 0) return null;

  // Split optional userinfo@host:port. Host = between last '@' and ':' / end.
  const at = authority.lastIndexOf('@');
  const userinfo = at === -1 ? '' : authority.slice(0, at + 1);
  const hostPort = at === -1 ? authority : authority.slice(at + 1);
  const colon = hostPort.indexOf(':');
  const host = colon === -1 ? hostPort : hostPort.slice(0, colon);
  const port = colon === -1 ? '' : hostPort.slice(colon);
  if (host.length === 0) return null;

  return { scheme, host, rest: `${userinfo}${port}${rest}` };
}

function canonicalUrl(parsed: ParsedUrl): string {
  return `${parsed.scheme.toLowerCase()}://${parsed.host.toLowerCase()}${parsed.rest}`;
}

export const urlType: TypeDefinition<string> = {
  name: 'url',
  codes: ['invalid', 'scheme', 'host'] as const,
  defaultUse: 'input',

  filter(raw: string, _constraints: Constraints, _ctx: Context): string {
    return raw.trim();
  },

  parse(raw: string, _constraints: Constraints, _ctx: Context): ParseResult<string> {
    if (raw.indexOf('://') === -1) return fail('invalid');
    return { ok: true, value: raw };
  },

  validate(value: string, _c: Constraints, _ctx: Context): ValidationResult {
    const errors: Issue[] = [];
    const parsed = splitUrl(value);
    if (!parsed) {
      // Distinguish the missing component where we can.
      if (value.indexOf('://') === -1) errors.push({ code: 'scheme' });
      else errors.push({ code: 'host' });
    }
    return result(errors, []);
  },

  normalize(value: string, _c: Constraints, _ctx: Context): string {
    const parsed = splitUrl(value);
    return parsed ? canonicalUrl(parsed) : value.trim();
  },

  serialize(value: string, c: Constraints, ctx: Context): string {
    return this.normalize(value, c, ctx);
  },

  deserialize(canonical: unknown, _ctx: Context): ParseResult<string> {
    if (typeof canonical !== 'string') return fail('invalid');
    const parsed = splitUrl(canonical);
    if (!parsed) return fail('invalid');
    return { ok: true, value: canonicalUrl(parsed) };
  },

  view(value: string, c: Constraints, ctx: Context): unknown {
    return this.normalize(value, c, ctx);
  },
};

/* ================================================================== *
 * ipv4 — RFC 791 dotted quad; reject out-of-range octets.
 * ================================================================== */

function parseIpv4(input: string): number[] | null {
  const parts = input.trim().split('.');
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const part of parts) {
    if (part.length === 0 || part.length > 3) return null;
    for (let i = 0; i < part.length; i++) {
      if (!isDigit(part[i])) return null;
    }
    // Reject leading zeros to keep one canonical decimal form.
    if (part.length > 1 && part[0] === '0') return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    out.push(n);
  }
  return out;
}

export const ipv4Type: TypeDefinition<string> = {
  name: 'ipv4',
  codes: ['invalid', 'shape', 'range'] as const,
  defaultUse: 'input',
  pattern: /^[0-9.]{7,15}$/,

  filter(raw: string, _constraints: Constraints, _ctx: Context): string {
    return raw.trim();
  },

  parse(raw: string, _constraints: Constraints, _ctx: Context): ParseResult<string> {
    if (raw.indexOf('.') === -1) return fail('invalid');
    return { ok: true, value: raw };
  },

  validate(value: string, _c: Constraints, _ctx: Context): ValidationResult {
    const errors: Issue[] = [];
    const parts = value.trim().split('.');
    if (parts.length !== 4) {
      errors.push({ code: 'shape' });
    } else if (!parseIpv4(value)) {
      // Shape is fine (4 dotted groups) but an octet is out of range / malformed.
      errors.push({ code: 'range' });
    }
    return result(errors, []);
  },

  normalize(value: string, _c: Constraints, _ctx: Context): string {
    const octets = parseIpv4(value);
    return octets ? octets.join('.') : value.trim();
  },

  serialize(value: string, c: Constraints, ctx: Context): string {
    return this.normalize(value, c, ctx);
  },

  deserialize(canonical: unknown, _ctx: Context): ParseResult<string> {
    if (typeof canonical !== 'string') return fail('invalid');
    const octets = parseIpv4(canonical);
    if (!octets) return fail('invalid');
    return { ok: true, value: octets.join('.') };
  },

  view(value: string, c: Constraints, ctx: Context): unknown {
    return this.normalize(value, c, ctx);
  },
};

/* ================================================================== *
 * ipv6 — RFC 4291. Canonical lowercase, compressed (RFC 5952) form.
 * ================================================================== */

/** Parse an IPv6 address into eight 16-bit groups, or null. */
function parseIpv6(input: string): number[] | null {
  let value = input.trim().toLowerCase();
  if (value.length === 0) return null;

  // Disallow surrounding brackets (those belong to URL authority, not the addr).
  if (value[0] === '[' || value[value.length - 1] === ']') return null;

  // Optional embedded IPv4 tail (e.g. ::ffff:1.2.3.4) → expand to two groups.
  const lastColon = value.lastIndexOf(':');
  if (value.indexOf('.') !== -1) {
    const tail = value.slice(lastColon + 1);
    const v4 = parseIpv4(tail);
    if (!v4) return null;
    const hi = (v4[0] << 8) | v4[1];
    const lo = (v4[2] << 8) | v4[3];
    value =
      value.slice(0, lastColon + 1) +
      hi.toString(16) +
      ':' +
      lo.toString(16);
  }

  const doubleColon = value.indexOf('::');
  if (doubleColon !== value.lastIndexOf('::')) return null; // at most one "::"

  let groups: number[];
  if (doubleColon === -1) {
    const raw = value.split(':');
    if (raw.length !== 8) return null;
    groups = [];
    for (const g of raw) {
      const n = parseGroup(g);
      if (n === null) return null;
      groups.push(n);
    }
  } else {
    const head = value.slice(0, doubleColon);
    const tail = value.slice(doubleColon + 2);
    const headParts = head.length ? head.split(':') : [];
    const tailParts = tail.length ? tail.split(':') : [];
    const fill = 8 - (headParts.length + tailParts.length);
    if (fill < 1) return null; // "::" must stand for at least one zero group
    groups = [];
    for (const g of headParts) {
      const n = parseGroup(g);
      if (n === null) return null;
      groups.push(n);
    }
    for (let i = 0; i < fill; i++) groups.push(0);
    for (const g of tailParts) {
      const n = parseGroup(g);
      if (n === null) return null;
      groups.push(n);
    }
  }
  return groups.length === 8 ? groups : null;
}

function parseGroup(g: string): number | null {
  if (g.length === 0 || g.length > 4) return null;
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (!isDigit(c) && (c < 'a' || c > 'f')) return null;
  }
  return parseInt(g, 16);
}

/** Compress eight groups to RFC 5952 canonical lowercase text. */
function compressIpv6(groups: number[]): string {
  const hex = groups.map((g) => g.toString(16));

  // Find the longest run of consecutive zero groups (length >= 2) to elide.
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;
  for (let i = 0; i < 8; i++) {
    if (groups[i] === 0) {
      if (curStart === -1) curStart = i;
      curLen++;
      if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
      }
    } else {
      curStart = -1;
      curLen = 0;
    }
  }

  if (bestLen < 2) return hex.join(':');

  const head = hex.slice(0, bestStart).join(':');
  const tail = hex.slice(bestStart + bestLen).join(':');
  return `${head}::${tail}`;
}

export const ipv6Type: TypeDefinition<string> = {
  name: 'ipv6',
  codes: ['invalid', 'shape'] as const,
  defaultUse: 'input',

  filter(raw: string, _constraints: Constraints, _ctx: Context): string {
    return raw.trim();
  },

  parse(raw: string, _constraints: Constraints, _ctx: Context): ParseResult<string> {
    if (raw.indexOf(':') === -1) return fail('invalid');
    return { ok: true, value: raw };
  },

  validate(value: string, _c: Constraints, _ctx: Context): ValidationResult {
    const errors: Issue[] = [];
    if (!parseIpv6(value)) errors.push({ code: 'shape' });
    return result(errors, []);
  },

  normalize(value: string, _c: Constraints, _ctx: Context): string {
    const groups = parseIpv6(value);
    return groups ? compressIpv6(groups) : value.trim().toLowerCase();
  },

  serialize(value: string, c: Constraints, ctx: Context): string {
    return this.normalize(value, c, ctx);
  },

  deserialize(canonical: unknown, _ctx: Context): ParseResult<string> {
    if (typeof canonical !== 'string') return fail('invalid');
    const groups = parseIpv6(canonical);
    if (!groups) return fail('invalid');
    return { ok: true, value: compressIpv6(groups) };
  },

  view(value: string, c: Constraints, ctx: Context): unknown {
    return this.normalize(value, c, ctx);
  },
};

/* ================================================================== *
 * datetime — canonical UTC ISO 8601 / RFC 3339; view is LOCAL.
 *
 * APPROACH (best-effort correct, no external libraries):
 *  - Internal value T is the canonical absolute instant as a UTC ISO string
 *    (e.g. "2024-03-10T07:30:00.000Z"). It is locale/timezone independent.
 *  - Input is interpreted as LOCAL wall-clock in ctx.timeZone. To turn a local
 *    wall-clock into an absolute instant we must find the UTC epoch ms whose
 *    rendering in ctx.timeZone equals the entered wall-clock.
 *  - We compute the zone's UTC offset at a candidate instant by formatting that
 *    instant with Intl.DateTimeFormat({ timeZone }) and comparing the formatted
 *    wall-clock to the candidate's UTC wall-clock (offset = wallUTC - rendered).
 *    See `zoneOffsetMs`. This uses only Intl + the IANA ctx.timeZone.
 *  - Local→UTC: take the desired wall-clock as if it were UTC (`asUTC`), probe
 *    the offset at that guess, subtract it, then re-probe once at the corrected
 *    instant to settle offsets that differ across a DST boundary.
 *  - DST disambiguation (RFC §4.5):
 *      * NON-EXISTENT local time (spring-forward gap): the corrected instant
 *        renders to a DIFFERENT wall-clock than entered. The two-step settle
 *        naturally yields an instant SHIFTED FORWARD by the gap, satisfying the
 *        "shift forward by the gap" rule.
 *      * AMBIGUOUS local time (fall-back, occurs twice): we deterministically
 *        select the EARLIER offset by preferring the larger offset candidate
 *        (earlier offset = more east = the first occurrence) in `localToUtcMs`.
 *  - view: format the absolute instant back into ctx.timeZone / ctx.locale.
 * ================================================================== */

interface WallClock {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  ms: number;
}

/** Render an absolute instant (epoch ms) into ctx.timeZone wall-clock parts. */
function renderInZone(epochMs: number, timeZone: string): WallClock {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(epochMs));
  const get = (t: string): number => {
    const p = parts.find((x) => x.type === t);
    return p ? Number(p.value) : 0;
  };
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
    ms: ((epochMs % 1000) + 1000) % 1000,
  };
}

/** Epoch ms of a wall-clock interpreted as if it were UTC. */
function wallToUTCms(w: WallClock): number {
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second, w.ms);
}

/**
 * UTC offset (ms) of `timeZone` at the given absolute instant.
 * offset = (wall-clock rendered in zone, read as UTC) - actual instant.
 * Positive east of UTC.
 */
function zoneOffsetMs(epochMs: number, timeZone: string): number {
  const w = renderInZone(epochMs, timeZone);
  return wallToUTCms(w) - epochMs;
}

/**
 * Convert a LOCAL wall-clock (in timeZone) to an absolute instant (epoch ms),
 * applying the RFC §4.5 disambiguation rule.
 */
function localToUtcMs(local: WallClock, timeZone: string): number {
  const asUTC = wallToUTCms(local);

  // First guess: assume the offset at the naive-UTC instant.
  const guessOffset = zoneOffsetMs(asUTC, timeZone);
  let candidate = asUTC - guessOffset;

  // Settle: re-probe the offset at the corrected instant and reapply once.
  const settledOffset = zoneOffsetMs(candidate, timeZone);
  if (settledOffset !== guessOffset) {
    candidate = asUTC - settledOffset;
  }

  // AMBIGUOUS time (two valid offsets, e.g. fall-back). Both candidates render
  // to the requested wall-clock. The earlier occurrence has the LARGER (more
  // eastward) offset, so prefer it per §4.5 ("earlier offset").
  const offA = zoneOffsetMs(asUTC - guessOffset, timeZone);
  const offB = zoneOffsetMs(asUTC - settledOffset, timeZone);
  const candA = asUTC - offA;
  const candB = asUTC - offB;
  const rendersExactly = (epoch: number): boolean => sameWall(renderInZone(epoch, timeZone), local);
  const aOk = rendersExactly(candA);
  const bOk = rendersExactly(candB);
  if (aOk && bOk && candA !== candB) {
    // Earlier offset ⇒ larger numeric offset ⇒ earlier instant.
    return Math.min(candA, candB);
  }
  if (aOk) return candA;
  if (bOk) return candB;

  // NON-EXISTENT time (spring-forward gap): no candidate renders exactly.
  // The two-step settle has already pushed `candidate` forward across the gap.
  return candidate;
}

function sameWall(a: WallClock, b: WallClock): boolean {
  return (
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day &&
    a.hour === b.hour &&
    a.minute === b.minute &&
    a.second === b.second
  );
}

function pad(n: number, width: number): string {
  let s = String(Math.abs(n));
  while (s.length < width) s = '0' + s;
  return (n < 0 ? '-' : '') + s;
}

/** Canonical UTC ISO 8601 / RFC 3339 string with millisecond precision. */
function toUtcIso(epochMs: number): string {
  const w = renderUTC(epochMs);
  return (
    `${pad(w.year, 4)}-${pad(w.month, 2)}-${pad(w.day, 2)}` +
    `T${pad(w.hour, 2)}:${pad(w.minute, 2)}:${pad(w.second, 2)}` +
    `.${pad(w.ms, 3)}Z`
  );
}

function renderUTC(epochMs: number): WallClock {
  const d = new Date(epochMs);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    ms: d.getUTCMilliseconds(),
  };
}

/**
 * Parse a flexible local datetime string into wall-clock parts. Accepts:
 *   "YYYY-MM-DD", "YYYY-MM-DDTHH:MM", "... HH:MM:SS", with optional ".sss".
 * Date and time may be separated by 'T' or a space. Returns null if malformed.
 * Note: this is LOCAL wall-clock; any trailing zone marker is rejected here so
 * an explicitly-zoned input is handled by `parseExplicitInstant` first.
 */
function parseLocalWall(input: string): WallClock | null {
  const s = input.trim().replace(' ', 'T');
  const m =
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?)?$/.exec(
      s,
    );
  if (!m) return null;
  const w: WallClock = {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: m[4] ? Number(m[4]) : 0,
    minute: m[5] ? Number(m[5]) : 0,
    second: m[6] ? Number(m[6]) : 0,
    ms: m[7] ? Number((m[7] + '000').slice(0, 3)) : 0,
  };
  return isValidWall(w) ? w : null;
}

function isValidWall(w: WallClock): boolean {
  if (w.month < 1 || w.month > 12) return false;
  if (w.day < 1 || w.day > 31) return false;
  if (w.hour > 23 || w.minute > 59 || w.second > 59) return false;
  // Reject impossible day-of-month using a UTC round-trip.
  const probe = new Date(Date.UTC(w.year, w.month - 1, w.day));
  return probe.getUTCMonth() === w.month - 1 && probe.getUTCDate() === w.day;
}

/**
 * If the input carries an explicit zone (trailing 'Z' or ±HH:MM), parse it
 * directly into an absolute instant — already unambiguous, no DST rule needed.
 */
function parseExplicitInstant(input: string): number | null {
  const s = input.trim();
  if (!/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) return null;
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : ms;
}

export const datetimeType: TypeDefinition<string> = {
  name: 'datetime',
  // 'invalid' (unparseable shape), 'range' (out-of-range components).
  codes: ['invalid', 'range'] as const,
  defaultUse: 'calendar',

  filter(raw: string, _constraints: Constraints, _ctx: Context): string {
    return raw.trim();
  },

  parse(raw: string, _constraints: Constraints, ctx: Context): ParseResult<string> {
    const explicit = parseExplicitInstant(raw);
    if (explicit !== null) return { ok: true, value: toUtcIso(explicit) };

    const wall = parseLocalWall(raw);
    if (!wall) return fail('invalid');
    const epoch = localToUtcMs(wall, ctx.timeZone);
    return { ok: true, value: toUtcIso(epoch) };
  },

  validate(value: string, _c: Constraints, _ctx: Context): ValidationResult {
    // `value` is already the canonical UTC ISO produced by parse/normalize.
    const ms = Date.parse(value);
    if (Number.isNaN(ms)) return result([{ code: 'invalid' }], []);
    return ok();
  },

  normalize(value: string, _c: Constraints, _ctx: Context): string {
    // Idempotent: re-canonicalize the absolute instant.
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? value : toUtcIso(ms);
  },

  serialize(value: string, c: Constraints, ctx: Context): string {
    return this.normalize(value, c, ctx);
  },

  deserialize(canonical: unknown, _ctx: Context): ParseResult<string> {
    if (typeof canonical !== 'string') return fail('invalid');
    const ms = Date.parse(canonical);
    if (Number.isNaN(ms)) return fail('invalid');
    return { ok: true, value: toUtcIso(ms) };
  },

  view(value: string, _c: Constraints, ctx: Context): unknown {
    const ms = Date.parse(value);
    if (Number.isNaN(ms)) return value;
    // LOCAL human projection — locale-aware text, formatted in
    // ctx.timeZone / ctx.locale. Canonical/serialize stays UTC ISO above.
    return new Intl.DateTimeFormat(ctx.locale, {
      timeZone: ctx.timeZone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(ms));
  },

  /**
   * TIME DUAL PROJECTION (RFC §2.5, §3.3): the three required representations of
   * a time-bearing value — LOCAL wall-clock text, UNIVERSAL-reference-frame
   * canonical UTC ISO, and the ABSOLUTE numeric instant. Pure: every
   * environment read comes from `ctx`; never consulted as canonical truth.
   */
  project(value: string, _c: Constraints, ctx: Context): Record<string, unknown> {
    const ms = Date.parse(value);
    const utc = Number.isNaN(ms) ? value : toUtcIso(ms);
    const local = Number.isNaN(ms)
      ? value
      : new Intl.DateTimeFormat(ctx.locale, {
          timeZone: ctx.timeZone,
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(new Date(ms));
    return { local, utc, epoch: ms };
  },
};

/* ================================================================== *
 * date — canonical ISO date (YYYY-MM-DD), no timezone.
 * ================================================================== */

function parseDateParts(input: string): WallClock | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim());
  if (!m) return null;
  const w: WallClock = {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: 0,
    minute: 0,
    second: 0,
    ms: 0,
  };
  return isValidWall(w) ? w : null;
}

function toIsoDate(w: WallClock): string {
  return `${pad(w.year, 4)}-${pad(w.month, 2)}-${pad(w.day, 2)}`;
}

export const dateType: TypeDefinition<string> = {
  name: 'date',
  codes: ['invalid', 'range'] as const,
  // A zoneless calendar date renders with a DATE control (`YYYY-MM-DD`), NOT the
  // datetime-local control (`calendar`, used by `datetime`). The latter emits a
  // time component the date fast-path pattern rejects. See the `date` widget.
  defaultUse: 'date',
  pattern: /^\d{4}-\d{2}-\d{2}$/,

  filter(raw: string, _constraints: Constraints, _ctx: Context): string {
    return raw.trim();
  },

  parse(raw: string, _constraints: Constraints, _ctx: Context): ParseResult<string> {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw.trim());
    if (!m) return fail('invalid');
    return { ok: true, value: `${m[1]}-${m[2]}-${m[3]}` };
  },

  validate(value: string, _c: Constraints, _ctx: Context): ValidationResult {
    const errors: Issue[] = [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
      errors.push({ code: 'invalid' });
    } else if (!parseDateParts(value)) {
      errors.push({ code: 'range' });
    }
    return result(errors, []);
  },

  normalize(value: string, _c: Constraints, _ctx: Context): string {
    const w = parseDateParts(value);
    return w ? toIsoDate(w) : value.trim();
  },

  serialize(value: string, c: Constraints, ctx: Context): string {
    return this.normalize(value, c, ctx);
  },

  deserialize(canonical: unknown, _ctx: Context): ParseResult<string> {
    if (typeof canonical !== 'string') return fail('invalid');
    const w = parseDateParts(canonical);
    if (!w) return fail('invalid');
    return { ok: true, value: toIsoDate(w) };
  },

  view(value: string, _c: Constraints, ctx: Context): unknown {
    const w = parseDateParts(value);
    if (!w) return value;
    // Locale-aware human text. The calendar date has no timezone, so it is
    // rendered as UTC midnight to avoid any zone shift. Canonical (the ISO
    // date string from serialize above) remains locale-independent.
    return new Intl.DateTimeFormat(ctx.locale, {
      timeZone: 'UTC',
      dateStyle: 'medium',
    }).format(new Date(Date.UTC(w.year, w.month - 1, w.day)));
  },

  /**
   * TIME DUAL PROJECTION (RFC §2.5, §3.3) for a zoneless calendar date: the
   * canonical ISO date plus its ABSOLUTE instant at UTC midnight (ms). Pure.
   */
  project(value: string, _c: Constraints, _ctx: Context): Record<string, unknown> {
    const w = parseDateParts(value);
    if (!w) return { iso: value, epoch: NaN };
    return {
      iso: toIsoDate(w),
      epoch: Date.UTC(w.year, w.month - 1, w.day),
    };
  },
};

/* ================================================================== *
 * time — zoneless time-of-day, canonical ISO 8601 local time (HH:MM:SS).
 * A wall-clock position, NOT an absolute instant: no date, no timezone is
 * attached (RFC §2.5 "zoneless temporal values", §7.3). The numeric instant
 * required by §2.5 is provided as a derived `msOfDay` projection only.
 * ================================================================== */

interface TimeParts {
  hour: number;
  minute: number;
  second: number;
}

/** Parse "HH:MM" or "HH:MM:SS" into range-checked parts; null if malformed. */
function parseTimeParts(input: string): TimeParts | null {
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(input.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  const second = m[3] ? Number(m[3]) : 0;
  if (hour > 23 || minute > 59 || second > 59) return null;
  return { hour, minute, second };
}

function toIsoTime(t: TimeParts): string {
  return `${pad(t.hour, 2)}:${pad(t.minute, 2)}:${pad(t.second, 2)}`;
}

export const timeType: TypeDefinition<string> = {
  name: 'time',
  codes: ['invalid', 'range'] as const,
  // Native time control (`<input type="time">`) emits `HH:MM[:SS]` — exactly
  // this canonical form, zoneless. See the `time` widget.
  defaultUse: 'time',
  pattern: /^\d{2}:\d{2}(:\d{2})?$/,

  filter(raw: string, _constraints: Constraints, _ctx: Context): string {
    return raw.trim();
  },

  parse(raw: string, _constraints: Constraints, _ctx: Context): ParseResult<string> {
    const m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(raw.trim());
    if (!m) return fail('invalid');
    return { ok: true, value: `${m[1]}:${m[2]}:${m[3] ?? '00'}` };
  },

  validate(value: string, _c: Constraints, _ctx: Context): ValidationResult {
    const errors: Issue[] = [];
    if (!/^\d{2}:\d{2}:\d{2}$/.test(value.trim())) {
      errors.push({ code: 'invalid' });
    } else if (!parseTimeParts(value)) {
      errors.push({ code: 'range' });
    }
    return result(errors, []);
  },

  normalize(value: string, _c: Constraints, _ctx: Context): string {
    const t = parseTimeParts(value);
    return t ? toIsoTime(t) : value.trim();
  },

  serialize(value: string, c: Constraints, ctx: Context): string {
    return this.normalize(value, c, ctx);
  },

  deserialize(canonical: unknown, _ctx: Context): ParseResult<string> {
    if (typeof canonical !== 'string') return fail('invalid');
    const t = parseTimeParts(canonical);
    if (!t) return fail('invalid');
    return { ok: true, value: toIsoTime(t) };
  },

  view(value: string, _c: Constraints, ctx: Context): unknown {
    const t = parseTimeParts(value);
    if (!t) return value;
    // Locale-aware human text. Zoneless: rendered at a fixed UTC reference date
    // so no timezone shift can occur. Canonical (HH:MM:SS) stays zoneless.
    return new Intl.DateTimeFormat(ctx.locale, {
      timeZone: 'UTC',
      timeStyle: 'short',
    }).format(new Date(Date.UTC(1970, 0, 1, t.hour, t.minute, t.second)));
  },

  /**
   * TIME DUAL PROJECTION (RFC §2.5, §3.3) for a zoneless time-of-day: the
   * canonical ISO time plus its position as milliseconds-of-day (the derived
   * numeric "instant", anchored to midnight — never canonical truth). Pure.
   */
  project(value: string, _c: Constraints, _ctx: Context): Record<string, unknown> {
    const t = parseTimeParts(value);
    if (!t) return { iso: value, msOfDay: NaN };
    return {
      iso: toIsoTime(t),
      msOfDay: ((t.hour * 60 + t.minute) * 60 + t.second) * 1000,
    };
  },
};

/* ================================================================== *
 * duration — ISO 8601 duration. Accept simple human forms; emit canonical.
 * Canonical internal value is the ISO string (e.g. "PT1H30M").
 * ================================================================== */

interface DurationParts {
  years: number;
  months: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

const ZERO_DURATION: DurationParts = {
  years: 0,
  months: 0,
  days: 0,
  hours: 0,
  minutes: 0,
  seconds: 0,
};

/** Parse an ISO 8601 duration (PnYnMnDTnHnMnS), no fractional/weeks. */
function parseIsoDuration(input: string): DurationParts | null {
  const m =
    /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
      input.trim().toUpperCase(),
    );
  if (!m) return null;
  // Reject the empty "P" with no components.
  if (!m.slice(1).some((g) => g !== undefined)) return null;
  return {
    years: m[1] ? Number(m[1]) : 0,
    months: m[2] ? Number(m[2]) : 0,
    days: m[3] ? Number(m[3]) : 0,
    hours: m[4] ? Number(m[4]) : 0,
    minutes: m[5] ? Number(m[5]) : 0,
    seconds: m[6] ? Number(m[6]) : 0,
  };
}

/** Parse simple human forms: "1h30m", "90 min", "2 days 4 hours", "45s". */
function parseHumanDuration(input: string): DurationParts | null {
  const s = input.trim().toLowerCase();
  if (s.length === 0) return null;
  const parts: DurationParts = { ...ZERO_DURATION };
  let matched = false;
  const re =
    /(\d+)\s*(years?|yrs?|y|months?|mo|weeks?|wk|w|days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/g;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(s)) !== null) {
    matched = true;
    const n = Number(mm[1]);
    const unit = mm[2];
    if (unit.startsWith('y')) parts.years += n;
    else if (unit === 'mo' || unit.startsWith('month')) parts.months += n;
    else if (unit === 'w' || unit === 'wk' || unit.startsWith('week'))
      parts.days += n * 7;
    else if (unit === 'd' || unit.startsWith('day')) parts.days += n;
    else if (unit === 'h' || unit.startsWith('hr') || unit.startsWith('hour'))
      parts.hours += n;
    else if (
      unit === 'm' ||
      unit === 'min' ||
      unit === 'mins' ||
      unit.startsWith('minute')
    )
      parts.minutes += n;
    else if (unit === 's' || unit.startsWith('sec')) parts.seconds += n;
  }
  return matched ? parts : null;
}

function toIsoDuration(p: DurationParts): string {
  let datePart = '';
  if (p.years) datePart += `${p.years}Y`;
  if (p.months) datePart += `${p.months}M`;
  if (p.days) datePart += `${p.days}D`;
  let timePart = '';
  if (p.hours) timePart += `${p.hours}H`;
  if (p.minutes) timePart += `${p.minutes}M`;
  if (p.seconds) timePart += `${p.seconds}S`;
  const body = datePart + (timePart ? `T${timePart}` : '');
  return body === '' ? 'PT0S' : `P${body}`;
}

function parseDuration(input: string): DurationParts | null {
  if (/^[pP]/.test(input.trim())) return parseIsoDuration(input);
  return parseHumanDuration(input);
}

export const durationType: TypeDefinition<string> = {
  name: 'duration',
  codes: ['invalid', 'shape'] as const,
  defaultUse: 'input',

  filter(raw: string, _constraints: Constraints, _ctx: Context): string {
    return raw.trim();
  },

  parse(raw: string, _constraints: Constraints, _ctx: Context): ParseResult<string> {
    const parts = parseDuration(raw);
    if (!parts) return fail('invalid');
    return { ok: true, value: toIsoDuration(parts) };
  },

  validate(value: string, _c: Constraints, _ctx: Context): ValidationResult {
    const errors: Issue[] = [];
    if (!parseIsoDuration(value)) errors.push({ code: 'shape' });
    return result(errors, []);
  },

  normalize(value: string, _c: Constraints, _ctx: Context): string {
    const parts = parseDuration(value);
    return parts ? toIsoDuration(parts) : value.trim();
  },

  serialize(value: string, c: Constraints, ctx: Context): string {
    return this.normalize(value, c, ctx);
  },

  deserialize(canonical: unknown, _ctx: Context): ParseResult<string> {
    if (typeof canonical !== 'string') return fail('invalid');
    const parts = parseIsoDuration(canonical);
    if (!parts) return fail('invalid');
    return { ok: true, value: toIsoDuration(parts) };
  },

  view(value: string, c: Constraints, ctx: Context): unknown {
    return this.normalize(value, c, ctx);
  },
};

/* ================================================================== *
 * currency — ISO 4217 alpha code. Uppercase; validate against a small set;
 * unknown 3-letter uppercase codes pass with a 'unknown' WARNING.
 * ================================================================== */

const KNOWN_CURRENCIES: ReadonlySet<string> = new Set([
  'USD', 'EUR', 'GBP', 'JPY', 'CNY', 'AUD', 'CAD', 'CHF', 'HKD', 'SGD',
  'SEK', 'NOK', 'DKK', 'NZD', 'INR', 'BRL', 'RUB', 'ZAR', 'MXN', 'KRW',
]);

const CURRENCY_CODE = /^[A-Za-z]{3}$/;

export const currencyType: TypeDefinition<string> = {
  name: 'currency',
  codes: ['invalid', 'shape', 'unknown'] as const,
  defaultUse: 'input',
  pattern: /^[A-Za-z]{3}$/,

  filter(raw: string, _constraints: Constraints, _ctx: Context): string {
    return raw.trim();
  },

  parse(raw: string, _constraints: Constraints, _ctx: Context): ParseResult<string> {
    if (raw.trim().length === 0) return fail('invalid');
    return { ok: true, value: raw.trim() };
  },

  validate(value: string, _c: Constraints, _ctx: Context): ValidationResult {
    const errors: Issue[] = [];
    const warnings: Issue[] = [];
    const up = value.trim().toUpperCase();
    if (!CURRENCY_CODE.test(up)) {
      errors.push({ code: 'shape' });
    } else if (!KNOWN_CURRENCIES.has(up)) {
      // Well-formed but not in the embedded set → non-blocking advisory.
      warnings.push({ code: 'unknown', params: { code: up } });
    }
    return result(errors, warnings);
  },

  normalize(value: string, _c: Constraints, _ctx: Context): string {
    return value.trim().toUpperCase();
  },

  serialize(value: string, c: Constraints, ctx: Context): string {
    return this.normalize(value, c, ctx);
  },

  deserialize(canonical: unknown, _ctx: Context): ParseResult<string> {
    if (typeof canonical !== 'string') return fail('invalid');
    const up = canonical.trim().toUpperCase();
    if (!CURRENCY_CODE.test(up)) return fail('invalid');
    return { ok: true, value: up };
  },

  view(value: string, c: Constraints, ctx: Context): unknown {
    return this.normalize(value, c, ctx);
  },
};

/* ================================================================== *
 * language — BCP-47 tag. Canonical casing: language lowercase, script
 * Titlecase, region UPPERCASE, variants/subtags lowercase.
 * ================================================================== */

const BCP47_SHAPE =
  /^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/;

/** Normalize subtag casing per BCP-47 conventions (best-effort, structural). */
function canonicalBcp47(input: string): string {
  const subtags = input.trim().split('-');
  return subtags
    .map((sub, i) => {
      if (i === 0) return sub.toLowerCase(); // primary language
      if (sub.length === 2 && /^[a-zA-Z]+$/.test(sub)) return sub.toUpperCase(); // region (alpha-2)
      if (sub.length === 3 && /^\d+$/.test(sub)) return sub; // region (numeric)
      if (sub.length === 4 && /^[a-zA-Z]+$/.test(sub))
        return sub[0].toUpperCase() + sub.slice(1).toLowerCase(); // script
      return sub.toLowerCase(); // variants / extensions
    })
    .join('-');
}

export const languageType: TypeDefinition<string> = {
  name: 'language',
  codes: ['invalid', 'shape'] as const,
  defaultUse: 'input',
  pattern: BCP47_SHAPE,

  filter(raw: string, _constraints: Constraints, _ctx: Context): string {
    return raw.trim();
  },

  parse(raw: string, _constraints: Constraints, _ctx: Context): ParseResult<string> {
    if (raw.trim().length === 0) return fail('invalid');
    return { ok: true, value: raw.trim() };
  },

  validate(value: string, _c: Constraints, _ctx: Context): ValidationResult {
    const errors: Issue[] = [];
    if (!BCP47_SHAPE.test(value.trim())) errors.push({ code: 'shape' });
    return result(errors, []);
  },

  normalize(value: string, _c: Constraints, _ctx: Context): string {
    return canonicalBcp47(value);
  },

  serialize(value: string, c: Constraints, ctx: Context): string {
    return this.normalize(value, c, ctx);
  },

  deserialize(canonical: unknown, _ctx: Context): ParseResult<string> {
    if (typeof canonical !== 'string') return fail('invalid');
    if (!BCP47_SHAPE.test(canonical.trim())) return fail('invalid');
    return { ok: true, value: canonicalBcp47(canonical) };
  },

  view(value: string, c: Constraints, ctx: Context): unknown {
    return this.normalize(value, c, ctx);
  },
};

/* ================================================================== *
 * timezone — IANA tz id. Validate via Intl.supportedValuesOf when available,
 * else fall back to a structural shape check.
 * ================================================================== */

const TZ_SHAPE = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;

/** Look up supported IANA zones if the runtime exposes them. */
function supportedTimeZones(): ReadonlySet<string> | null {
  const sov = (
    Intl as unknown as {
      supportedValuesOf?: (key: string) => string[];
    }
  ).supportedValuesOf;
  if (typeof sov !== 'function') return null;
  try {
    return new Set(sov('timeZone'));
  } catch {
    return null;
  }
}

/** Case-insensitive resolution to the runtime's canonical zone id. */
function canonicalTimeZone(input: string): string {
  const trimmed = input.trim();
  if (trimmed.toUpperCase() === 'UTC') return 'UTC';
  const zones = supportedTimeZones();
  if (zones) {
    if (zones.has(trimmed)) return trimmed;
    const lower = trimmed.toLowerCase();
    for (const z of zones) {
      if (z.toLowerCase() === lower) return z; // adopt the runtime's casing
    }
  }
  return trimmed; // shape-only acceptance: keep as entered
}

function isValidTimeZone(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed.toUpperCase() === 'UTC') return true;
  const zones = supportedTimeZones();
  if (zones) {
    if (zones.has(trimmed)) return true;
    const lower = trimmed.toLowerCase();
    for (const z of zones) {
      if (z.toLowerCase() === lower) return true;
    }
    return false;
  }
  return TZ_SHAPE.test(trimmed);
}

export const timezoneType: TypeDefinition<string> = {
  name: 'timezone',
  codes: ['invalid', 'unknown'] as const,
  defaultUse: 'input',
  pattern: TZ_SHAPE,

  filter(raw: string, _constraints: Constraints, _ctx: Context): string {
    return raw.trim();
  },

  parse(raw: string, _constraints: Constraints, _ctx: Context): ParseResult<string> {
    if (raw.trim().length === 0) return fail('invalid');
    return { ok: true, value: raw.trim() };
  },

  validate(value: string, _c: Constraints, _ctx: Context): ValidationResult {
    const errors: Issue[] = [];
    if (!isValidTimeZone(value)) errors.push({ code: 'unknown' });
    return result(errors, []);
  },

  normalize(value: string, _c: Constraints, _ctx: Context): string {
    return canonicalTimeZone(value);
  },

  serialize(value: string, c: Constraints, ctx: Context): string {
    return this.normalize(value, c, ctx);
  },

  deserialize(canonical: unknown, _ctx: Context): ParseResult<string> {
    if (typeof canonical !== 'string') return fail('invalid');
    if (canonical.trim().length === 0) return fail('invalid');
    return { ok: true, value: canonicalTimeZone(canonical) };
  },

  view(value: string, c: Constraints, ctx: Context): unknown {
    return this.normalize(value, c, ctx);
  },
};

/* ================================================================== *
 * json — T = parsed value (unknown).
 *   parse      → JSON.parse.
 *   serialize  → deterministic stringify (sorted object keys).
 *   deserialize→ JSON.parse (idempotent: serialize(deserialize(x)) === x for
 *                any already-canonical/sorted string).
 *   view       → pretty (2-space) string.
 * ================================================================== */

/** Deterministic JSON: object keys sorted recursively. Arrays keep order. */
function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

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

export const jsonType: TypeDefinition<unknown> = {
  name: 'json',
  codes: ['invalid'] as const,
  defaultUse: 'input',

  filter(raw: string, _constraints: Constraints, _ctx: Context): string {
    return raw.trim();
  },

  parse(raw: string, _constraints: Constraints, _ctx: Context): ParseResult<unknown> {
    try {
      return { ok: true, value: JSON.parse(raw) };
    } catch {
      return fail('invalid');
    }
  },

  validate(value: unknown, _c: Constraints, _ctx: Context): ValidationResult {
    // Any value JSON.parse produced is structurally valid JSON. Guard against
    // a non-serializable value (e.g. injected functions/symbols) defensively.
    const errors: Issue[] = [];
    try {
      JSON.stringify(value);
    } catch {
      errors.push({ code: 'invalid' });
    }
    return result(errors, []);
  },

  normalize(value: unknown, _c: Constraints, _ctx: Context): unknown {
    // Round-trip through the deterministic form so the internal value is stable.
    return sortValue(value);
  },

  serialize(value: unknown, _c: Constraints, _ctx: Context): unknown {
    // Canonical = deterministically stringified (sorted-key) JSON text.
    return stableStringify(value);
  },

  deserialize(canonical: unknown, _ctx: Context): ParseResult<unknown> {
    if (typeof canonical !== 'string') {
      // Tolerate an already-parsed canonical value.
      return { ok: true, value: sortValue(canonical) };
    }
    try {
      return { ok: true, value: sortValue(JSON.parse(canonical)) };
    } catch {
      return fail('invalid');
    }
  },

  view(value: unknown, _c: Constraints, _ctx: Context): unknown {
    // Human projection: pretty-printed, sorted-key JSON.
    return JSON.stringify(sortValue(value), null, 2);
  },
};

/* ------------------------------------------------------------------ *
 * Registry bundle
 * ------------------------------------------------------------------ */

export const semanticTypes: TypeDefinition[] = [
  emailType,
  uuidType,
  urlType,
  ipv4Type,
  ipv6Type,
  datetimeType,
  dateType,
  timeType,
  durationType,
  currencyType,
  languageType,
  timezoneType,
  jsonType,
];
