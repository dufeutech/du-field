/**
 * AGGREGATE / VIRTUAL-FORM (RFC §2.17, §3.9) + CROSS-FIELD DEPENDENCIES
 * (RFC §2.16, §4.12).
 *
 * An aggregate composes existing field instances into one combined canonical
 * record and one combined validity. It lives in the application layer: it holds
 * NO domain logic and MUST NOT change how any member field compiles its own value
 * (RFC §3.9). Dependencies may affect only validity / requiredness / visibility,
 * never a member's canonical projection (RFC §2.16). Cyclic dependencies are
 * detected and reported rather than evaluated indefinitely (RFC §4.12).
 */

import type {
  Aggregate,
  Field,
  Dependency,
  DependencyEffect,
  Context,
  Issue,
} from '../core/contracts';
import { ABSENT } from '../core/contracts';

export interface AggregateOptions {
  dependencies?: readonly Dependency[];
  /** Context used to evaluate dependencies; defaults to a neutral context. */
  context?: Context;
}

/** Aggregate plus the application-layer extras the runtime/widget need. */
export interface AggregateRuntime extends Aggregate {
  /** Dependency-derived issues per member field name. */
  issues(): Record<string, Issue[]>;
  /** Raw dependency effects (hidden/required/errors) per member field name. */
  effects(): Record<string, DependencyEffect>;
  /** Update the context used for dependency evaluation. */
  setContext(ctx: Context): void;
}

const NEUTRAL: Context = { now: 0, timeZone: 'UTC', locale: 'en' };

export function createAggregate(
  fields: Field[],
  options: AggregateOptions = {},
): AggregateRuntime {
  const dependencies = options.dependencies ?? [];
  let ctx = options.context ?? NEUTRAL;

  detectCycles(dependencies);

  const byName = new Map<string, Field>();
  for (const f of fields) byName.set(f.name, f);

  const subscribers = new Set<(a: AggregateRuntime) => void>();

  function members(): Record<string, Field> {
    const m: Record<string, Field> = {};
    for (const [k, v] of byName) m[k] = v;
    return m;
  }

  function effects(): Map<string, DependencyEffect> {
    const map = new Map<string, DependencyEffect>();
    const m = members();
    for (const dep of dependencies) {
      // A dependency reading a missing member resolves to a defined no-op
      // rather than failing (RFC §4.12).
      const eff = dep.evaluate(m, ctx);
      const prev = map.get(dep.target) ?? {};
      map.set(dep.target, {
        required: Boolean(prev.required) || Boolean(eff.required),
        hidden: Boolean(prev.hidden) || Boolean(eff.hidden),
        errors: [...(prev.errors ?? []), ...(eff.errors ?? [])],
      });
    }
    return map;
  }

  function isEmpty(f: Field): boolean {
    return f.value.canonical === ABSENT || f.value.raw.trim().length === 0;
  }

  function derivedIssues(): Record<string, Issue[]> {
    const out: Record<string, Issue[]> = {};
    for (const [name, e] of effects()) {
      const f = byName.get(name);
      const list: Issue[] = [...(e.errors ?? [])];
      if (e.required && f && isEmpty(f)) list.push({ code: 'required' });
      if (list.length > 0) out[name] = list;
    }
    return out;
  }

  function isValid(): boolean {
    if (!fields.every((f) => f.state.valid)) return false;
    return Object.keys(derivedIssues()).length === 0;
  }

  function notify(): void {
    for (const fn of [...subscribers]) fn(agg);
  }

  const agg: AggregateRuntime = {
    get fields() {
      return fields;
    },
    get valid() {
      return isValid();
    },
    canonical(runCtx: Context): Record<string, unknown> | undefined {
      ctx = runCtx;
      if (!isValid()) return undefined;
      const record: Record<string, unknown> = {};
      // Absent keys are omitted; hidden fields are still compiled (RFC §4.9).
      for (const f of fields) {
        if (f.value.canonical !== ABSENT) record[f.name] = f.value.canonical;
      }
      return record;
    },
    field(name: string): Field | undefined {
      return byName.get(name);
    },
    issues(): Record<string, Issue[]> {
      return derivedIssues();
    },
    effects(): Record<string, DependencyEffect> {
      const out: Record<string, DependencyEffect> = {};
      for (const [name, e] of effects()) out[name] = e;
      return out;
    },
    setContext(c: Context): void {
      ctx = c;
    },
    subscribe(fn: (a: AggregateRuntime) => void): () => void {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },
  };

  for (const f of fields) f.subscribe(() => notify());

  return agg;
}

/** Detect cycles in the dependency graph (reads → target). Throws if cyclic. */
function detectCycles(deps: readonly Dependency[]): void {
  const graph = new Map<string, Set<string>>();
  for (const d of deps) {
    for (const r of d.reads) {
      // A field referencing itself (e.g. valid-if "end >= start" reads `end`)
      // is normal, not a cycle — only cross-field cycles matter.
      if (r === d.target) continue;
      let set = graph.get(r);
      if (!set) {
        set = new Set<string>();
        graph.set(r, set);
      }
      set.add(d.target);
    }
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();

  function dfs(node: string): boolean {
    color.set(node, GRAY);
    for (const next of graph.get(node) ?? []) {
      const c = color.get(next) ?? WHITE;
      if (c === GRAY) return true;
      if (c === WHITE && dfs(next)) return true;
    }
    color.set(node, BLACK);
    return false;
  }

  for (const node of graph.keys()) {
    if ((color.get(node) ?? WHITE) === WHITE && dfs(node)) {
      throw new Error('du-field: cyclic field dependency detected');
    }
  }
}
