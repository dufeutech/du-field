/**
 * COMPILE ENGINE — the ordered transformation pipeline (RFC §2.2, §4.11).
 *
 * This module is PURE (./rules.md §3, RFC §3.8): no DOM, no framework, no ambient
 * reads. `compile` is a deterministic function of (type, raw, constraints, ctx).
 *
 * Pipeline order (RFC §2.2):
 *   empty/required → filter → (fast-path pattern) → parse → validate
 *     (type-intrinsic THEN engine-level constraints) → normalize → serialize.
 *
 * Composition rule (RFC §4.11): never short-circuit validation — collect ALL
 * errors and warnings in a stable, deterministic order. Errors gate canonical
 * output (RFC §2.7); warnings never block. Absent vs null vs empty stay distinct
 * (RFC §3.3, §4.1): on empty-optional the canonical is ABSENT (or null on opt-in);
 * on parse failure / any error the canonical is ABSENT while raw is retained.
 */

import type {
  TypeDefinition,
  Context,
  Constraints,
  FieldValue,
  FieldState,
  Issue,
} from '../core/contracts';
import { ABSENT } from '../core/contracts';

/** Bound on raw input length (RFC §2.18 — untrusted, bounded input). */
const MAX_RAW_LENGTH = 100_000;

/** Bound on a single match() evaluation's input length (RFC §2.18 fast-path). */
const MAX_MATCH_INPUT = 10_000;

/** The portion of FieldState the pure pipeline can decide. */
type PipelineState = Pick<FieldState, 'valid' | 'errors' | 'warnings'>;

function issue(code: string, params?: Record<string, unknown>): Issue {
  return params ? { code, params } : { code };
}

/**
 * Evaluate an author-declared `match` pattern against text with a bounded guard
 * (RFC §2.18): over-long input is rejected rather than risking pathological
 * backtracking, and a malformed pattern fails closed (treated as non-matching).
 */
function matchesPattern(pattern: string, text: string): boolean {
  if (text.length > MAX_MATCH_INPUT) return false;
  let re: RegExp;
  try {
    re = new RegExp(pattern);
  } catch {
    return false;
  }
  return re.test(text);
}

/**
 * Engine-level constraint checks layered ABOVE the type's own validate (RFC
 * §4.11: type-intrinsic first, then author constraints). Collects, never
 * short-circuits. Operates on the parsed value plus the entered/view text.
 */
function constraintErrors(
  value: unknown,
  raw: string,
  constraints: Constraints,
): Issue[] {
  const errors: Issue[] = [];

  // choices membership (RFC §2.9) — compare against the declared choice values
  // (author-declared raw strings). For a collection-valued field (`multiple`)
  // EVERY selected item must be an allowed choice; otherwise the entered raw must
  // equal one allowed value.
  if (constraints.choices && constraints.choices.length > 0) {
    const allowedValues = new Set(constraints.choices.map((c) => c.value));
    const allowed =
      constraints.multiple && Array.isArray(value)
        ? (value as unknown[]).every((item) => allowedValues.has(String(item)))
        : allowedValues.has(raw);
    if (!allowed) errors.push(issue('choice'));
  }

  // semantic/pattern matcher (RFC §2.8) — bounded-time evaluation (RFC §2.18).
  if (constraints.match !== undefined) {
    if (!matchesPattern(constraints.match, raw)) {
      errors.push(issue('match', { match: constraints.match }));
    }
  }

  // collection constraints (RFC §2.8, §2.9, §4.10) — only when the field is
  // collection-valued; then min/max read as item-count (resolved-type rule).
  if (constraints.multiple && Array.isArray(value)) {
    const items = value as unknown[];
    if (constraints.minItems !== undefined && items.length < constraints.minItems) {
      errors.push(issue('minItems', { minItems: constraints.minItems }));
    }
    if (constraints.maxItems !== undefined && items.length > constraints.maxItems) {
      errors.push(issue('maxItems', { maxItems: constraints.maxItems }));
    }
    if (constraints.unique) {
      const seen = new Set<string>();
      let dup = false;
      for (const item of items) {
        const key = JSON.stringify(item ?? null);
        if (seen.has(key)) {
          dup = true;
          break;
        }
        seen.add(key);
      }
      if (dup) errors.push(issue('unique'));
    }
  }

  return errors;
}

/**
 * Compile one raw human string into a dual-projection value plus the pipeline
 * portion of field state. Always returns a defined result — invalid input yields
 * an invalid state with errors, never a throw (RFC §3.2, §4.2).
 */
export function compile(
  type: TypeDefinition,
  raw: string,
  constraints: Constraints,
  ctx: Context,
): { value: FieldValue; state: PipelineState } {
  // Bound untrusted raw length up front (RFC §2.18). Over-long input is invalid;
  // raw is retained for the human, canonical suppressed.
  if (raw.length > MAX_RAW_LENGTH) {
    return {
      value: { raw, view: '', canonical: ABSENT, valid: false },
      state: { valid: false, errors: [issue('invalid')], warnings: [] },
    };
  }

  // 1. EMPTY / REQUIRED handling FIRST (RFC §4.1, §3.3). Empty is never coerced
  //    to null; we do NOT call type.parse on empty input.
  if (raw.trim().length === 0) {
    if (constraints.required) {
      return {
        value: { raw, view: '', canonical: ABSENT, valid: false },
        state: { valid: false, errors: [issue('required')], warnings: [] },
      };
    }
    // Optional-empty: valid; omit the key (ABSENT) unless the author opted into
    // an explicit null (RFC §3.3 absent vs null).
    return {
      value: {
        raw,
        view: '',
        canonical: constraints.emitNull ? null : ABSENT,
        valid: true,
      },
      state: { valid: true, errors: [], warnings: [] },
    };
  }

  // 2. filter → optional fast-path pattern check (RFC §2.2, §2.18). A failed
  //    fast-path short-circuits to an invalid result while retaining raw.
  const filtered = type.filter(raw, constraints, ctx);
  if (type.pattern && !type.pattern.test(filtered)) {
    return {
      value: { raw, view: '', canonical: ABSENT, valid: false },
      state: { valid: false, errors: [issue('invalid')], warnings: [] },
    };
  }

  // 3. parse → on failure invalid, RETAIN raw, canonical ABSENT (RFC §4.2).
  const parsed = type.parse(filtered, constraints, ctx);
  if (!parsed.ok) {
    return {
      value: { raw, view: '', canonical: ABSENT, valid: false },
      state: { valid: false, errors: [issue(parsed.code)], warnings: [] },
    };
  }
  const parsedValue = parsed.value;

  // 4. validate — type-intrinsic FIRST, then engine-level constraints (RFC
  //    §4.11). Collect ALL issues in stable order; do NOT short-circuit.
  const typeResult = type.validate(parsedValue, constraints, ctx);
  const errors: Issue[] = [...typeResult.errors];
  const warnings: Issue[] = [...typeResult.warnings];
  errors.push(...constraintErrors(parsedValue, raw, constraints));

  // 5. Any ERROR → invalid; canonical ABSENT (RFC §2.7, §4.3). Warnings never
  //    block. Still compute a view from the parsed value when possible so the
  //    widget can echo the human's intent.
  if (errors.length > 0) {
    let view: unknown = '';
    try {
      view = type.view(parsedValue, constraints, ctx);
    } catch {
      view = '';
    }
    return {
      value: { raw, view, canonical: ABSENT, valid: false },
      state: { valid: false, errors, warnings },
    };
  }

  // 6. Valid → normalize → serialize → canonical; view + extended projections
  //    from the normalized value (RFC §2.5, §3.3).
  const normalized = type.normalize(parsedValue, constraints, ctx);
  const canonical = type.serialize(normalized, constraints, ctx);
  const view = type.view(normalized, constraints, ctx);
  const projections = type.project
    ? type.project(normalized, constraints, ctx)
    : undefined;

  return {
    value: projections
      ? { raw, view, canonical, valid: true, projections }
      : { raw, view, canonical, valid: true },
    state: { valid: true, errors: [], warnings },
  };
}
