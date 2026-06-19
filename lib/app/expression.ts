/**
 * DEPENDENCY EXPRESSION SURFACE (RFC §2.16, §7) — a tiny, safe, kid-simple
 * condition language for cross-field rules.
 *
 * Grammar (lowest → highest precedence):
 *   or   := and ( "or" and )*
 *   and  := cmp ( "and" cmp )*
 *   cmp  := operand ( op operand )?        // a bare operand = truthiness
 *   op   := "==" | "!=" | ">" | "<" | ">=" | "<="
 *   operand := identifier | number | string | "true" | "false"
 *
 * An identifier refers to another field by name; its value is that field's
 * canonical projection. Examples authors write:
 *   required-if="country == 'US'"
 *   valid-if="end >= start"            (with message="End must be after start")
 *   visible-if="subscribe == true"
 *   hidden-if="plan == 'free'"
 *
 * No `eval`, no function calls, no property access — only comparisons and
 * and/or. Pure: a compiled condition is a function of a values map only.
 */

export interface CompiledCondition {
  /** Field names this condition reads (its dependency inputs). */
  readonly reads: readonly string[];
  /** Evaluate against a map of field-name → canonical value. */
  evaluate(values: Readonly<Record<string, unknown>>): boolean;
}

type Token =
  | { kind: 'ident'; value: string }
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'bool'; value: boolean }
  | { kind: 'op'; value: string }
  | { kind: 'and' }
  | { kind: 'or' };

const OPS = ['==', '!=', '>=', '<=', '>', '<'];

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1;
      continue;
    }
    // string literal
    if (ch === "'" || ch === '"') {
      const quote = ch;
      let j = i + 1;
      let str = '';
      while (j < src.length && src[j] !== quote) {
        str += src[j];
        j += 1;
      }
      if (j >= src.length) throw new Error('du-field: unterminated string in expression');
      tokens.push({ kind: 'string', value: str });
      i = j + 1;
      continue;
    }
    // operator
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op) {
      tokens.push({ kind: 'op', value: op });
      i += op.length;
      continue;
    }
    // number
    if (ch >= '0' && ch <= '9') {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j += 1;
      tokens.push({ kind: 'number', value: Number(src.slice(i, j)) });
      i = j;
      continue;
    }
    // identifier / keyword
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j += 1;
      const word = src.slice(i, j);
      if (word === 'and') tokens.push({ kind: 'and' });
      else if (word === 'or') tokens.push({ kind: 'or' });
      else if (word === 'true') tokens.push({ kind: 'bool', value: true });
      else if (word === 'false') tokens.push({ kind: 'bool', value: false });
      else tokens.push({ kind: 'ident', value: word });
      i = j;
      continue;
    }
    throw new Error(`du-field: unexpected character "${ch}" in expression`);
  }
  return tokens;
}

/** An operand resolves to a concrete value given the field-values map. */
type Operand = {
  /** field name read, if this operand is an identifier */
  read?: string;
  resolve(values: Readonly<Record<string, unknown>>): unknown;
};

function numericOf(v: unknown): number | undefined {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function truthy(v: unknown): boolean {
  if (v === undefined || v === null || v === false) return false;
  if (v === true) return true;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v !== '' && v !== 'false' && v !== '0';
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

function equalish(a: unknown, b: unknown): boolean {
  const na = numericOf(a);
  const nb = numericOf(b);
  if (na !== undefined && nb !== undefined) return na === nb;
  if (typeof a === 'boolean' || typeof b === 'boolean') {
    return truthy(a) === truthy(b);
  }
  return String(a) === String(b);
}

function ordered(a: unknown, b: unknown, op: string): boolean {
  const na = numericOf(a);
  const nb = numericOf(b);
  let cmp: number;
  if (na !== undefined && nb !== undefined) cmp = na < nb ? -1 : na > nb ? 1 : 0;
  else {
    const sa = String(a);
    const sb = String(b);
    cmp = sa < sb ? -1 : sa > sb ? 1 : 0;
  }
  if (op === '>') return cmp > 0;
  if (op === '<') return cmp < 0;
  if (op === '>=') return cmp >= 0;
  return cmp <= 0; // '<='
}

/** Parse a condition expression into a compiled, pure predicate. */
export function parseCondition(expr: string): CompiledCondition {
  const tokens = tokenize(expr);
  const reads = new Set<string>();
  let pos = 0;

  const peek = (): Token | undefined => tokens[pos];

  function operand(): Operand {
    const t = tokens[pos];
    if (!t) throw new Error('du-field: expected a value in expression');
    pos += 1;
    if (t.kind === 'ident') {
      reads.add(t.value);
      const name = t.value;
      return { read: name, resolve: (v) => v[name] };
    }
    if (t.kind === 'string' || t.kind === 'number' || t.kind === 'bool') {
      const literal = t.value;
      return { resolve: () => literal };
    }
    throw new Error('du-field: expected a value in expression');
  }

  function cmp(): (v: Readonly<Record<string, unknown>>) => boolean {
    const left = operand();
    const next = peek();
    if (next && next.kind === 'op') {
      pos += 1;
      const op = next.value;
      const right = operand();
      return (v) => {
        const l = left.resolve(v);
        const r = right.resolve(v);
        if (op === '==') return equalish(l, r);
        if (op === '!=') return !equalish(l, r);
        return ordered(l, r, op);
      };
    }
    // bare operand → truthiness
    return (v) => truthy(left.resolve(v));
  }

  function andExpr(): (v: Readonly<Record<string, unknown>>) => boolean {
    let fn = cmp();
    while (peek()?.kind === 'and') {
      pos += 1;
      const rhs = cmp();
      const lhs = fn;
      fn = (v) => lhs(v) && rhs(v);
    }
    return fn;
  }

  function orExpr(): (v: Readonly<Record<string, unknown>>) => boolean {
    let fn = andExpr();
    while (peek()?.kind === 'or') {
      pos += 1;
      const rhs = andExpr();
      const lhs = fn;
      fn = (v) => lhs(v) || rhs(v);
    }
    return fn;
  }

  const evaluate = orExpr();
  if (pos !== tokens.length) {
    throw new Error('du-field: trailing tokens in expression');
  }

  return { reads: [...reads], evaluate };
}
