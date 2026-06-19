/**
 * DEFAULT WIDGETS (RFC §2.10, §3.4) — purely presentational DOM adapters.
 *
 * A widget renders from (value, state, text, constraints) and emits raw input.
 * It performs NO filtering, parsing, validation, normalization, or domain logic,
 * and holds no canonical truth. Any widget compatible with a field's `use` is
 * interchangeable without affecting compilation or output.
 *
 * Rendering is idempotent: the structure is built once per host and reused so
 * caret/focus survive re-renders; only values, labels, and errors are updated.
 */

import type { Widget, WidgetProps } from '../core/contracts';

interface Entry {
  use: string;
  control: HTMLInputElement | HTMLSelectElement;
  labelText: HTMLSpanElement;
  help: HTMLDivElement;
  preview: HTMLDivElement;
  errorsEl: HTMLDivElement;
  props: WidgetProps;
}

const registry = new WeakMap<HTMLElement, Entry>();

function makeControl(use: string): HTMLInputElement | HTMLSelectElement {
  if (use === 'switch') {
    const i = document.createElement('input');
    i.type = 'checkbox';
    return i;
  }
  if (use === 'select') {
    return document.createElement('select');
  }
  if (use === 'calendar') {
    const i = document.createElement('input');
    i.type = 'datetime-local';
    return i;
  }
  if (use === 'date') {
    // Native date control emits exactly `YYYY-MM-DD` — the date type's canonical
    // form — with no time component (unlike `calendar`/datetime-local).
    const i = document.createElement('input');
    i.type = 'date';
    return i;
  }
  if (use === 'time') {
    // Native time control emits `HH:MM[:SS]` — the zoneless time canonical form.
    const i = document.createElement('input');
    i.type = 'time';
    return i;
  }
  if (use === 'number') {
    const i = document.createElement('input');
    i.type = 'text';
    i.inputMode = 'decimal';
    return i;
  }
  const i = document.createElement('input');
  i.type = 'text';
  return i;
}

function ensure(host: HTMLElement, use: string): Entry {
  const existing = registry.get(host);
  if (existing && existing.use === use) return existing;

  host.textContent = '';
  host.classList.add('du-field');

  const label = document.createElement('label');
  label.className = 'du-field__label';

  const labelText = document.createElement('span');
  labelText.className = 'du-field__label-text';

  const control = makeControl(use);
  control.className = 'du-field__control';

  const help = document.createElement('div');
  help.className = 'du-field__help';

  const preview = document.createElement('div');
  preview.className = 'du-field__view';

  const errorsEl = document.createElement('div');
  errorsEl.className = 'du-field__errors';

  label.appendChild(labelText);
  label.appendChild(control);
  host.appendChild(label);
  host.appendChild(help);
  host.appendChild(preview);
  host.appendChild(errorsEl);

  const entry: Entry = {
    use,
    control,
    labelText,
    help,
    preview,
    errorsEl,
    props: undefined as unknown as WidgetProps,
  };

  // Wire events ONCE; handlers read the latest props off the entry.
  const emit = (): void => {
    const p = entry.props;
    if (!p) return;
    if (control instanceof HTMLInputElement && control.type === 'checkbox') {
      p.onInput(control.checked ? 'true' : 'false');
      return;
    }
    if (control instanceof HTMLSelectElement) {
      p.onInput(control.value);
      return;
    }
    // Text-like control: apply the field's filter LIVE (RFC §2.2) so characters
    // the type can never accept (e.g. letters in a number) are removed as typed
    // instead of surfacing a reactive error. Caret is preserved.
    const input = control as HTMLInputElement;
    const before = input.value;
    const filtered = p.filter(before);
    if (filtered !== before) {
      const caret = input.selectionStart ?? before.length;
      input.value = filtered;
      const pos = Math.max(0, caret - (before.length - filtered.length));
      try {
        input.setSelectionRange(pos, pos);
      } catch {
        // some input types don't support selection ranges — ignore.
      }
    }
    p.onInput(filtered);
  };
  control.addEventListener('input', emit);
  control.addEventListener('change', emit);
  control.addEventListener('blur', () => entry.props?.onTouch());

  registry.set(host, entry);
  return entry;
}

function renderInto(host: HTMLElement, props: WidgetProps): void {
  const entry = ensure(host, props.use);
  entry.props = props;

  const { control } = entry;
  const required = Boolean(props.constraints.required);

  // Label (with a simple required marker).
  entry.labelText.textContent = props.text.label + (required ? ' *' : '');

  // Disabled / readonly (presentation only — RFC §4.9).
  const disabled = Boolean(props.constraints.disabled);
  const readonly = Boolean(props.constraints.readonly);
  (control as HTMLInputElement).disabled = disabled;
  if (control instanceof HTMLInputElement) control.readOnly = readonly;
  // Note: host visibility is managed by the element (it merges static `hidden`
  // with dependency-driven visibility), not by the widget.

  // Choices for selects.
  if (control instanceof HTMLSelectElement) {
    const choices = props.constraints.choices ?? [];
    const wanted = choices.map((c) => c.value).join('');
    if (control.dataset.choices !== wanted) {
      control.textContent = '';
      if (!required) control.appendChild(new Option('', ''));
      for (const c of choices) control.appendChild(new Option(c.value, c.value));
      control.dataset.choices = wanted;
    }
    control.value = props.value.raw;
  } else if (control instanceof HTMLInputElement && control.type === 'checkbox') {
    control.checked = props.value.canonical === true;
  } else {
    // Don't clobber the caret while the user is typing.
    if (document.activeElement !== control) {
      control.value = props.value.raw;
    }
  }

  // Help text.
  entry.help.textContent = props.text.help && !props.text.help.startsWith('[')
    ? props.text.help
    : '';
  entry.help.style.display = entry.help.textContent ? '' : 'none';

  // Dual-projection preview: human view + any extended projections, shown when
  // the field holds a valid value (RFC §2.3, §2.5). Echoes how the same input
  // reads to a human vs. what downstream consumers receive.
  if (props.state.valid && props.value.canonical !== undefined && props.value.raw.trim() !== '') {
    const view = props.value.view;
    const parts: string[] = [];
    if (typeof view === 'string' && view && view !== props.value.raw) {
      parts.push(view);
    }
    const proj = props.value.projections;
    if (proj) {
      for (const key of Object.keys(proj)) {
        const v = proj[key];
        if (key === 'formatted') continue; // already shown as the view
        parts.push(`${key}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
      }
    }
    entry.preview.textContent = parts.join('  •  ');
  } else {
    entry.preview.textContent = '';
  }
  entry.preview.style.display = entry.preview.textContent ? '' : 'none';

  // Errors (only once touched, to avoid shouting at a pristine field).
  const showErrors = props.state.touched && props.text.errors.length > 0;
  entry.errorsEl.textContent = showErrors ? props.text.errors.join(' ') : '';
  entry.errorsEl.style.display = showErrors ? '' : 'none';
  host.classList.toggle('du-field--invalid', showErrors);
  host.classList.toggle('du-field--valid', props.state.touched && props.state.valid);
}

function widget(use: string): Widget {
  return { use, render: renderInto };
}

/** The built-in widget set keyed by `use`. */
export const defaultWidgets: Widget[] = [
  widget('input'),
  widget('number'),
  widget('switch'),
  widget('calendar'),
  widget('date'),
  widget('time'),
  widget('select'),
  widget('tags'),
];
