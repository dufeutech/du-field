/**
 * `<ui-field>` — THE single input primitive (RFC §2.1, §16.1), as a framework-
 * agnostic custom element. Everything else is configuration.
 *
 * The element is a thin composition root per instance: it reads its attributes
 * into a FieldConfig + Constraints, asks the runtime to compile a Field, resolves
 * an interchangeable Widget by `use`, and renders. It holds NO domain logic — all
 * truth lives in the field/type (RFC §2.10). It emits a `du-change` event carrying
 * the canonical projection whenever the value changes.
 */

import type {
  Field,
  FieldConfig,
  Constraints,
  Context,
  Registry,
  I18n,
  Widget,
  WidgetProps,
  Choice,
} from '../core/contracts';
import { ABSENT } from '../core/contracts';
import { buildTextBundle } from '../i18n/i18n';
import { humanize } from '../app/inference';

/** What the element needs from the runtime (satisfied by the index Runtime). */
export interface ElementRuntime {
  registry: Registry;
  i18n: I18n;
  context(overrides?: Partial<Context>): Context;
  createField(config: FieldConfig, ctx: Context): Field;
}

const BOOL_ATTRS = [
  'required', 'disabled', 'readonly', 'hidden', 'emit-null', 'dot-decimal',
];

const OBSERVED = [
  'name', 'type', 'use', 'id', 'label', 'help',
  'min', 'max', 'step', 'scale', 'currency', 'match', 'default', 'choices', 'locale',
  ...BOOL_ATTRS,
];

function parseChoices(raw: string | null): Choice[] | undefined {
  if (!raw) return undefined;
  const text = raw.trim();
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.map((v) =>
        typeof v === 'object' && v !== null
          ? (v as Choice)
          : { value: String(v) },
      );
    }
  } catch {
    // fall through to comma-separated form
  }
  return text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((value) => ({ value }));
}

export function defineUiField(
  runtime: ElementRuntime,
  tag = 'ui-field',
): void {
  if (customElements.get(tag)) return;

  class UiField extends HTMLElement {
    static get observedAttributes(): string[] {
      return OBSERVED;
    }

    private field?: Field;
    private unsubscribe?: () => void;
    private connected = false;
    private depHidden = false;
    private depMessages: string[] = [];

    connectedCallback(): void {
      this.connected = true;
      this.build();
    }

    disconnectedCallback(): void {
      this.connected = false;
      this.unsubscribe?.();
      this.unsubscribe = undefined;
    }

    attributeChangedCallback(): void {
      if (this.connected) this.build();
    }

    /** Current canonical projection (undefined when absent/invalid). */
    get value(): unknown {
      const c = this.field?.value.canonical;
      return c === ABSENT ? undefined : c;
    }

    get valid(): boolean {
      return this.field?.state.valid ?? false;
    }

    /** Human-facing view projection. */
    get viewValue(): unknown {
      return this.field?.value.view;
    }

    /** Extended type-specific projections (e.g. time local/utc/epoch). */
    get projections(): Readonly<Record<string, unknown>> | undefined {
      return this.field?.value.projections;
    }

    get fieldInstance(): Field | undefined {
      return this.field;
    }

    /**
     * Stable identity of the compiled field — the key under which its snapshots
     * live in the runtime's StatePort. Use it to reach the backing store for
     * reactive consumption, e.g. `runtime.state.store(el.fieldId)` when the
     * runtime is nanostores-backed. Stable across attribute-driven rebuilds.
     */
    get fieldId(): string | undefined {
      return this.field?.id;
    }

    private constraints(): Constraints {
      const attr = (n: string): string | undefined =>
        this.getAttribute(n) ?? undefined;
      const num = (n: string): number | undefined => {
        const v = this.getAttribute(n);
        if (v === null) return undefined;
        const parsed = Number(v);
        return Number.isFinite(parsed) ? parsed : undefined;
      };
      return {
        required: this.hasAttribute('required'),
        disabled: this.hasAttribute('disabled'),
        readonly: this.hasAttribute('readonly'),
        hidden: this.hasAttribute('hidden'),
        emitNull: this.hasAttribute('emit-null'),
        dotDecimal: this.hasAttribute('dot-decimal'),
        min: attr('min'),
        max: attr('max'),
        step: attr('step'),
        scale: num('scale'),
        currency: attr('currency'),
        match: attr('match'),
        default: attr('default'),
        choices: parseChoices(this.getAttribute('choices')),
      };
    }

    private build(): void {
      const name = this.getAttribute('name');
      if (!name) return; // a field needs a name; nothing to do yet.

      this.unsubscribe?.();

      const ctx = runtime.context({
        locale: this.getAttribute('locale') ?? undefined,
      });

      // Keep ONE stable field id across attribute-driven rebuilds: an explicit
      // `id` attr wins; otherwise reuse the id assigned on the first build so we
      // address the SAME StatePort entry (atom) instead of orphaning a fresh one
      // each rebuild (the field counter would otherwise advance every time).
      const config: FieldConfig = {
        name,
        type: this.getAttribute('type') ?? undefined,
        use: this.getAttribute('use') ?? undefined,
        id: this.getAttribute('id') ?? this.field?.id ?? undefined,
        constraints: this.constraints(),
      };

      this.field = runtime.createField(config, ctx);
      this.unsubscribe = this.field.subscribe(() => {
        this.paint(ctx);
        this.emitChange();
      });
      this.paint(ctx);
      this.emitChange();
    }

    /**
     * Apply a dependency effect WITHOUT rebuilding the field (RFC §2.16): the
     * field keeps compiling its own value; only visibility and surfaced messages
     * change. Called by an enclosing form. Does NOT emit du-change (no value
     * change), so it cannot loop with the form's re-evaluation.
     */
    setDependencyState(state: { hidden?: boolean; messages?: string[] }): void {
      if (state.hidden !== undefined) this.depHidden = state.hidden;
      if (state.messages !== undefined) this.depMessages = state.messages;
      const ctx = runtime.context({
        locale: this.getAttribute('locale') ?? undefined,
      });
      this.paint(ctx);
    }

    private applyVisibility(): void {
      const hidden = this.hasAttribute('hidden') || this.depHidden;
      this.style.display = hidden ? 'none' : '';
    }

    private emitChange(): void {
      const field = this.field;
      if (!field) return;
      this.dispatchEvent(
        new CustomEvent('du-change', {
          bubbles: true,
          detail: {
            name: field.name,
            valid: field.state.valid,
            value: this.value,
          },
        }),
      );
    }

    private resolveLabel(field: Field, typeLabel: string): string {
      const explicit = this.getAttribute('label');
      if (explicit) return explicit;
      if (typeLabel && !typeLabel.startsWith('[')) return typeLabel;
      return humanize(field.name);
    }

    private paint(ctx: Context): void {
      const field = this.field;
      if (!field) return;
      this.applyVisibility();

      const widget =
        (runtime.registry.get('widget', field.use) as Widget | undefined) ??
        (runtime.registry.get('widget', 'input') as Widget | undefined);
      if (!widget) return;

      const text = buildTextBundle(
        field.type,
        runtime.i18n,
        ctx.locale,
        field.state.errors,
        field.state.warnings,
      );
      text.label = this.resolveLabel(field, text.label);
      if (this.depMessages.length > 0) {
        text.errors = [...text.errors, ...this.depMessages];
      }

      const props: WidgetProps = {
        value: field.value,
        state: field.state,
        text,
        constraints: this.constraints(),
        use: field.use,
        onInput: (raw: string) =>
          field.setRaw(
            raw,
            runtime.context({
              locale: this.getAttribute('locale') ?? undefined,
            }),
          ),
        onTouch: () => field.touch(),
        filter: (raw: string) =>
          field.filter(
            raw,
            runtime.context({
              locale: this.getAttribute('locale') ?? undefined,
            }),
          ),
      };

      widget.render(this, props);
    }
  }

  customElements.define(tag, UiField);
}
