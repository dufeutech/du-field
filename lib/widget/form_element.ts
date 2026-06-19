/**
 * `<ui-form>` — the AGGREGATE / VIRTUAL-FORM surface (RFC §2.17, §3.9) and the
 * author-facing home for cross-field DEPENDENCIES (RFC §2.16, §7).
 *
 * It groups child `<ui-field>` elements, compiles their declarative dependency
 * attributes into `Dependency` objects, and on every change re-evaluates the
 * aggregate and pushes effects (visibility + messages) back to each field —
 * WITHOUT rebuilding any field (a field never stops owning its own value).
 *
 * Declarative attributes on a child `<ui-field>`:
 *   required-if="<condition>"   field becomes required when the condition holds
 *   visible-if="<condition>"    field shown only when the condition holds
 *   hidden-if="<condition>"     field hidden when the condition holds
 *   valid-if="<condition>"      field invalid when the condition is false
 *   message="<text>"            message shown for a failed valid-if
 *
 * Conditions are the kid-simple expression language in ./app/expression.
 *
 * The form exposes `.value` (combined canonical record, or undefined when
 * invalid) and `.valid`, and emits `du-form-change` on every update.
 */

import type { Field, Issue, Context, I18n, Dependency } from '../core/contracts';
import type { AggregateRuntime } from '../app/aggregate';
import { createAggregate } from '../app/aggregate';
import {
  requiredIf,
  visibleIf,
  hiddenIf,
  validIf,
} from '../app/dependency';
import { buildKey } from '../i18n/i18n';

export interface FormRuntime {
  i18n: I18n;
  context(overrides?: Partial<Context>): Context;
}

interface FieldEl extends HTMLElement {
  fieldInstance?: Field;
  setDependencyState?(state: { hidden?: boolean; messages?: string[] }): void;
}

function compileDependencies(elements: FieldEl[]): Dependency[] {
  const deps: Dependency[] = [];
  for (const el of elements) {
    const name = el.getAttribute('name');
    if (!name) continue;
    const add = (
      builder: (t: string, e: string) => Dependency,
      attr: string,
    ): void => {
      const expr = el.getAttribute(attr);
      if (!expr) return;
      try {
        deps.push(builder(name, expr));
      } catch {
        // A malformed expression is ignored rather than breaking the form.
      }
    };
    add(requiredIf, 'required-if');
    add(visibleIf, 'visible-if');
    add(hiddenIf, 'hidden-if');
    const validExpr = el.getAttribute('valid-if');
    if (validExpr) {
      try {
        deps.push(validIf(name, validExpr, el.getAttribute('message') ?? undefined));
      } catch {
        /* ignore malformed */
      }
    }
  }
  return deps;
}

export function defineUiForm(runtime: FormRuntime, tag = 'ui-form'): void {
  if (customElements.get(tag)) return;

  class UiForm extends HTMLElement {
    private agg?: AggregateRuntime;
    private signature = '';

    connectedCallback(): void {
      this.addEventListener('du-change', this.onChange);
      // Children upgrade asynchronously; (re)build on the next microtask.
      queueMicrotask(() => {
        this.rebuild();
        this.evaluate();
      });
    }

    disconnectedCallback(): void {
      this.removeEventListener('du-change', this.onChange);
    }

    /** Combined canonical record, or undefined when the form is invalid. */
    get value(): Record<string, unknown> | undefined {
      if (!this.agg) return undefined;
      return this.agg.canonical(runtime.context());
    }

    get valid(): boolean {
      return this.agg?.valid ?? false;
    }

    private fieldElements(): FieldEl[] {
      return [...this.querySelectorAll('ui-field')] as FieldEl[];
    }

    private onChange = (): void => {
      this.rebuild();
      this.evaluate();
    };

    /** Rebuild the aggregate only when the set of member fields changes. */
    private rebuild(): void {
      const els = this.fieldElements().filter((e) => e.fieldInstance);
      const fields = els.map((e) => e.fieldInstance as Field);
      const sig = fields.map((f) => f.id).join('|');
      if (sig === this.signature && this.agg) return;
      this.signature = sig;
      if (fields.length === 0) {
        this.agg = undefined;
        return;
      }
      const deps = compileDependencies(els);
      this.agg = createAggregate(fields, {
        dependencies: deps,
        context: runtime.context(),
      });
    }

    private resolveIssue(issue: Issue, locale: string): string {
      const msg = issue.params?.message;
      if (typeof msg === 'string' && msg) return msg;
      return runtime.i18n.resolve(buildKey('*', 'error', issue.code), locale, issue.params);
    }

    private evaluate(): void {
      const agg = this.agg;
      if (!agg) return;
      const ctx = runtime.context();
      agg.setContext(ctx);

      const issues = agg.issues();
      const effects = agg.effects();

      for (const el of this.fieldElements()) {
        const name = el.getAttribute('name');
        if (!name || !el.setDependencyState) continue;
        const hidden = effects[name]?.hidden ?? false;
        const messages = (issues[name] ?? []).map((i) => this.resolveIssue(i, ctx.locale));
        el.setDependencyState({ hidden, messages });
      }

      this.dispatchEvent(
        new CustomEvent('du-form-change', {
          bubbles: true,
          detail: { valid: agg.valid, value: agg.canonical(ctx) },
        }),
      );
    }
  }

  customElements.define(tag, UiForm);
}
