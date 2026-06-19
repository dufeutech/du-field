/**
 * AUTHOR-FACING FACADE — a thin singleton over the runtime (RFC §2.1; §5
 * "minimal surface" / "approachability"). This is an EXTERNAL layer
 * (./rules.md §2): it depends INWARD on the application layer + adapters and the
 * core MUST NOT import it. It only composes existing parts.
 *
 * It removes the two recurring sources of boilerplate:
 *   1. Assembling a runtime and wiring a state adapter.
 *   2. Threading explicit Context through every value operation.
 * and makes the built-in nanostores adapter the DEFAULT so every field is
 * reactively observable out of the box (handle.store / du.store(id)).
 *
 * It changes NO canonical behavior (./rules.md §1, §5 "display-into-truth"):
 * compilation still runs in the pure core; the facade merely samples ambient
 * context at the one allowed boundary (./app/context.ts) per operation and
 * forwards it explicitly. Removing this facade leaves canonical output
 * unchanged — authors can always drop to createRuntime() directly.
 */

import type { ReadableAtom } from 'nanostores';
import type {
  Field,
  FieldState,
  FieldConfig,
  FieldSnapshot,
  Constraints,
  Choice,
  Context,
  Dependency,
  Dictionary,
} from '../core/contracts';
import { ABSENT } from '../core/contracts';
import { createRuntime } from '../index';
import type { Runtime } from '../index';
import { createNanoState } from '../state/nanostores';
import type { NanoStatePort } from '../state/nanostores';
import { createAggregate } from '../app/aggregate';
import { defineUiField } from '../widget/element';
import { defineUiForm } from '../widget/form_element';

/* ------------------------------------------------------------------ *
 * Flat author options — type/use/id plus every Constraint inline, so a field
 * is one call with one flat object instead of a nested FieldConfig.
 * `choices` additionally accepts plain strings (the common case).
 * ------------------------------------------------------------------ */

export interface DuFieldOptions extends Omit<Partial<Constraints>, 'choices'> {
  type?: string;
  use?: string;
  id?: string;
  choices?: readonly (string | Choice)[];
}

/** Configuration for the singleton; all optional, all with working defaults. */
export interface DuConfig {
  /** Author dictionary merged over the built-in English defaults. */
  dictionary?: Dictionary;
  /** Default locale tag for text resolution and view formatting. */
  locale?: string;
  /** Base context overrides applied before ambient sampling. */
  context?: Partial<Context>;
}

/** Split a flat options object into the nested FieldConfig the core expects. */
function toConfig(name: string, options: DuFieldOptions): FieldConfig {
  const { type, use, id, choices, ...rest } = options;
  const constraints: Constraints = { ...rest };
  if (choices) {
    constraints.choices = choices.map((c) =>
      typeof c === 'string' ? { value: c } : c,
    );
  }
  return { name, type, use, id, constraints };
}

/* ------------------------------------------------------------------ *
 * Field handle — wraps a core Field so value operations need no explicit
 * Context (the singleton supplies it) and the backing atom is one property away.
 * ------------------------------------------------------------------ */

export interface DuFieldHandle {
  /** Escape hatch to the underlying core Field. */
  readonly field: Field;
  readonly id: string;
  readonly name: string;
  /** Canonical projection; `undefined` when absent (key omitted) or invalid. */
  readonly value: unknown;
  /** Human-facing view projection. */
  readonly view: unknown;
  readonly valid: boolean;
  readonly state: FieldState;
  /** Extended type-specific projections (e.g. time → local/utc/epoch). */
  readonly projections: Readonly<Record<string, unknown>> | undefined;
  /** The reactive nanostores atom for this field (read-only; observe/get). */
  readonly store: ReadableAtom<FieldSnapshot | undefined>;
  /** Apply raw input; context is sampled for you. Chainable. */
  set(raw: string): DuFieldHandle;
  /** Mark interacted-with. Chainable. */
  touch(): DuFieldHandle;
  /** Restore the default; clears dirty/touched. Chainable. */
  reset(): DuFieldHandle;
  /** Observe changes (fires on every value/state change, not immediately). */
  subscribe(fn: (handle: DuFieldHandle) => void): () => void;
}

function makeFieldHandle(field: Field, du: Du): DuFieldHandle {
  const handle: DuFieldHandle = {
    field,
    get id() {
      return field.id;
    },
    get name() {
      return field.name;
    },
    get value() {
      const c = field.value.canonical;
      return c === ABSENT ? undefined : c;
    },
    get view() {
      return field.value.view;
    },
    get valid() {
      return field.state.valid;
    },
    get state() {
      return field.state;
    },
    get projections() {
      return field.value.projections;
    },
    get store() {
      return du.store(field.id);
    },
    set(raw: string) {
      field.setRaw(raw, du.context());
      return handle;
    },
    touch() {
      field.touch();
      return handle;
    },
    reset() {
      field.reset(du.context());
      return handle;
    },
    subscribe(fn) {
      return field.subscribe(() => fn(handle));
    },
  };
  return handle;
}

/* ------------------------------------------------------------------ *
 * Form handle — wraps an aggregate (virtual-form). Compose fields by a flat
 * name → options map; cross-field dependencies pass straight through.
 * ------------------------------------------------------------------ */

export interface DuFormOptions {
  /** Cross-field dependencies (build with requiredIf/visibleIf/hiddenIf/validIf). */
  dependencies?: readonly Dependency[];
}

export interface DuFormHandle {
  readonly valid: boolean;
  /** Combined canonical record; `undefined` while invalid (RFC §2.17). */
  readonly value: Record<string, unknown> | undefined;
  /** A member field handle by name. */
  field(name: string): DuFieldHandle | undefined;
  /** All member field handles in declaration order. */
  readonly fields: readonly DuFieldHandle[];
  subscribe(fn: (handle: DuFormHandle) => void): () => void;
}

/* ------------------------------------------------------------------ *
 * The singleton. One instance owns one runtime + one nanostores state adapter.
 * ------------------------------------------------------------------ */

export class Du {
  private static _instance?: Du;

  private _runtime?: Runtime;
  private _state?: NanoStatePort;
  private _config: DuConfig = {};

  // Singleton: construct only via Du.instance / the exported `du`.
  private constructor() {}

  /** The single shared instance. */
  static get instance(): Du {
    if (!Du._instance) Du._instance = new Du();
    return Du._instance;
  }

  /**
   * Configure before first use (dictionary, default locale, base context).
   * State is always the built-in nanostores adapter — that is the facade's
   * identity; for a custom state port use createRuntime() directly. Calling
   * configure() resets any already-built runtime/state. Chainable.
   */
  configure(config: DuConfig): this {
    this._config = { ...config };
    this._runtime = undefined;
    this._state = undefined;
    return this;
  }

  /** Lazily assemble the runtime + nanostores state on first use. */
  private ensure(): Runtime {
    if (!this._runtime) {
      this._state = createNanoState();
      this._runtime = createRuntime({
        dictionary: this._config.dictionary,
        defaultLocale: this._config.locale,
        context: this._config.context,
        state: this._state,
      });
    }
    return this._runtime;
  }

  /** The underlying runtime (built on demand). */
  get runtime(): Runtime {
    return this.ensure();
  }

  /** The nanostores-backed state port (built on demand). */
  get state(): NanoStatePort {
    this.ensure();
    return this._state as NanoStatePort;
  }

  get registry(): Runtime['registry'] {
    return this.ensure().registry;
  }

  get i18n(): Runtime['i18n'] {
    return this.ensure().i18n;
  }

  /** Build an explicit Context (ambient sample + configured/extra overrides). */
  context(overrides?: Partial<Context>): Context {
    return this.ensure().context(overrides);
  }

  /** The reactive atom for a field id (shortcut for state.store(id)). */
  store(id: string): ReadableAtom<FieldSnapshot | undefined> {
    return this.state.store(id);
  }

  /** Create a field from a flat options object. */
  field(name: string, options: DuFieldOptions = {}): DuFieldHandle {
    const rt = this.ensure();
    const field = rt.createField(toConfig(name, options), rt.context());
    return makeFieldHandle(field, this);
  }

  /**
   * Compose a virtual-form from a flat name → options map. Member order follows
   * the map's insertion order. Optional cross-field dependencies pass through.
   */
  form(
    spec: Record<string, DuFieldOptions>,
    options: DuFormOptions = {},
  ): DuFormHandle {
    const rt = this.ensure();
    const handles = Object.entries(spec).map(([name, opts]) =>
      this.field(name, opts),
    );
    const byName = new Map(handles.map((h) => [h.name, h]));
    const aggregate = createAggregate(
      handles.map((h) => h.field),
      { dependencies: options.dependencies, context: rt.context() },
    );

    const handle: DuFormHandle = {
      get valid() {
        return aggregate.valid;
      },
      get value() {
        return aggregate.canonical(rt.context());
      },
      field(name: string) {
        return byName.get(name);
      },
      fields: handles,
      subscribe(fn) {
        return aggregate.subscribe(() => fn(handle));
      },
    };
    return handle;
  }

  /**
   * Register the `<ui-field>` and `<ui-form>` custom elements bound to this
   * singleton's runtime. DOM-only; throws a defined error off-DOM (RFC §4 —
   * fail defined, never undefined). Chainable.
   */
  define(): this {
    if (typeof customElements === 'undefined') {
      throw new Error(
        'du-field: define() requires a DOM environment (customElements is unavailable)',
      );
    }
    const rt = this.ensure();
    defineUiField(rt);
    defineUiForm(rt);
    return this;
  }

  /** Tear down the runtime/state/config (primarily for tests). Chainable. */
  reset(): this {
    this._runtime = undefined;
    this._state = undefined;
    this._config = {};
    return this;
  }
}

/** The shared singleton instance — the primary author entry point. */
export const du = Du.instance;
export default du;
