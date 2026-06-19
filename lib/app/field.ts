/**
 * FIELD INSTANCE / LIFECYCLE — one runtime instance of the single primitive
 * (RFC §3.2). Resolves type/use/id (RFC §2.12, §4.7, §4.8), seeds the default
 * through the same pipeline as human input (RFC §2.8), and tracks observable
 * state (RFC §2.7) while delegating persistence/observation to a `StatePort`.
 *
 * This module is deterministic: the only impurity tolerated is a module-level
 * monotonic id counter used solely when no id is supplied and no `idgen` is
 * provided (never `Math.random` / `Date.now`). The compile engine itself stays
 * pure (./pipeline). The state layer is fully removable without changing any
 * canonical projection (RFC §2.14, §3.8).
 */

import type {
  Field,
  FieldConfig,
  FieldValue,
  FieldState,
  FieldSnapshot,
  Context,
  Constraints,
  Registry,
  StatePort,
  TypeDefinition,
} from '../core/contracts';
import { compile } from './pipeline';
import { createMemoryState } from '../state/memory';

/** Deterministic fallback id source (RFC §4.8 — no ambient randomness/time). */
let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `field-${idCounter}`;
}

/** Wiring a field needs from its environment (registry + optional adapters). */
export interface FieldDeps {
  registry: Registry;
  state?: StatePort;
  inferType?: (name: string) => string;
  inferUse?: (typeName: string) => string;
  idgen?: () => string;
}

/**
 * Construct a field instance. Resolves type (explicit > inference > 'string'),
 * use (explicit > inference > type.defaultUse), and id (explicit > idgen >
 * deterministic counter), then seeds the value from the declared default through
 * the pipeline. A field carrying only its default starts not-dirty / not-touched
 * (RFC §2.8). Throws a clear Error when the resolved type is unregistered (RFC
 * §4.8); all other invalid input yields a defined invalid state (RFC §3.2).
 */
export function createField(
  config: FieldConfig,
  deps: FieldDeps,
  ctx: Context,
): Field {
  const constraints: Constraints = config.constraints ?? {};

  // Type resolution precedence (RFC §4.7): explicit > inference > generic default.
  const typeName =
    config.type ?? deps.inferType?.(config.name) ?? 'string';
  const typeDef: TypeDefinition | undefined = deps.registry.getType(typeName);
  if (!typeDef) {
    throw new Error(
      `du-field: unknown type "${typeName}" for field "${config.name}" (not registered)`,
    );
  }

  // Use resolution (RFC §2.12): explicit > inference > type default.
  const use = config.use ?? deps.inferUse?.(typeName) ?? typeDef.defaultUse;

  // Id resolution (RFC §4.8): explicit > supplied idgen > deterministic counter.
  const id = config.id ?? deps.idgen?.() ?? nextId();

  const state: StatePort = deps.state ?? createMemoryState();
  const subscribers = new Set<(field: Field) => void>();

  // Mutable lifecycle flags kept outside the snapshot's pipeline-derived part.
  let dirty = false;
  let touched = false;

  /** Build a full FieldState from a pipeline outcome plus lifecycle flags. */
  function buildState(
    pipeline: Pick<FieldState, 'valid' | 'errors' | 'warnings'>,
  ): FieldState {
    return {
      valid: pipeline.valid,
      dirty,
      touched,
      pending: false, // async is out of scope here (RFC §4.13) — default false.
      errors: pipeline.errors,
      warnings: pipeline.warnings,
    };
  }

  // Seed the initial value from the declared default through the SAME pipeline
  // as human input (RFC §2.8). Default raw is '' when none is declared.
  const initialRaw = constraints.default ?? '';
  const initialCompiled = compile(typeDef, initialRaw, constraints, ctx);
  let currentValue: FieldValue = initialCompiled.value;
  let currentState: FieldState = buildState(initialCompiled.state);

  state.create(id, { value: currentValue, state: currentState });

  /** Persist the current snapshot and notify field-level subscribers. */
  function commit(notifySubscribers: boolean): void {
    const snapshot: FieldSnapshot = { value: currentValue, state: currentState };
    state.set(id, snapshot);
    if (notifySubscribers) {
      for (const fn of [...subscribers]) fn(field);
    }
  }

  const field: Field = {
    get id() {
      return id;
    },
    get name() {
      return config.name;
    },
    get type() {
      return typeName;
    },
    get use() {
      return use;
    },
    get value() {
      return currentValue;
    },
    get state() {
      return currentState;
    },

    setRaw(raw: string, runCtx: Context): void {
      const result = compile(typeDef, raw, constraints, runCtx);
      currentValue = result.value;
      dirty = true; // a human edit modifies the field (RFC §2.8).
      currentState = buildState(result.state);
      commit(true);
    },

    filter(raw: string, runCtx: Context): string {
      return typeDef.filter(raw, constraints, runCtx);
    },

    touch(): void {
      touched = true;
      currentState = { ...currentState, touched };
      commit(true);
    },

    reset(runCtx: Context): void {
      const result = compile(typeDef, initialRaw, constraints, runCtx);
      currentValue = result.value;
      dirty = false;
      touched = false;
      currentState = buildState(result.state);
      commit(true);
    },

    subscribe(fn: (field: Field) => void): () => void {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },
  };

  return field;
}
