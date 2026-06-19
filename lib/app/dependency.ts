/**
 * DECLARATIVE DEPENDENCY BUILDERS (RFC §2.16) — compile a kid-simple condition
 * string into a `Dependency` the aggregate can evaluate. These live in the
 * application layer; they never touch the domain core and only ever affect a
 * field's validity / requiredness / visibility, never its canonical value.
 */

import type { Dependency, Field, Context } from '../core/contracts';
import { ABSENT } from '../core/contracts';
import { parseCondition } from './expression';

/** Field-name → canonical value (ABSENT collapses to undefined for conditions). */
function valuesOf(
  members: Readonly<Record<string, Field>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const name of Object.keys(members)) {
    const c = members[name]?.value.canonical;
    out[name] = c === ABSENT ? undefined : c;
  }
  return out;
}

function hasValue(field: Field | undefined): boolean {
  return (
    !!field && field.value.canonical !== ABSENT && field.value.raw.trim() !== ''
  );
}

/** `target` becomes required when the condition holds. */
export function requiredIf(target: string, expr: string): Dependency {
  const cond = parseCondition(expr);
  return {
    reads: cond.reads,
    target,
    evaluate: (members, _ctx: Context) => ({
      required: cond.evaluate(valuesOf(members)),
    }),
  };
}

/** `target` is shown only when the condition holds. */
export function visibleIf(target: string, expr: string): Dependency {
  const cond = parseCondition(expr);
  return {
    reads: cond.reads,
    target,
    evaluate: (members, _ctx: Context) => ({
      hidden: !cond.evaluate(valuesOf(members)),
    }),
  };
}

/** `target` is hidden when the condition holds. */
export function hiddenIf(target: string, expr: string): Dependency {
  const cond = parseCondition(expr);
  return {
    reads: cond.reads,
    target,
    evaluate: (members, _ctx: Context) => ({
      hidden: cond.evaluate(valuesOf(members)),
    }),
  };
}

/**
 * `target` must satisfy the condition (e.g. `end >= start`). Only flags an error
 * once the target actually has a value, so it never double-reports with required.
 * The optional `message` is surfaced verbatim (already human text).
 */
export function validIf(
  target: string,
  expr: string,
  message?: string,
): Dependency {
  const cond = parseCondition(expr);
  return {
    reads: cond.reads,
    target,
    evaluate: (members, _ctx: Context) => {
      if (hasValue(members[target]) && !cond.evaluate(valuesOf(members))) {
        return {
          errors: [
            { code: 'depInvalid', params: message ? { message } : undefined },
          ],
        };
      }
      return {};
    },
  };
}
