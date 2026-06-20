/**
 * WARIA BRIDGE — shared helpers + widget factory.
 *
 * Every waria-backed widget is the same shape: build du-field's field chrome
 * once (label / help / preview / errors), mount a waria custom element as the
 * control, wire its `change` event to `onInput`, and on each render reflect the
 * field's value/state onto the element's reactive props. This module factors out
 * everything that is identical across widgets so each widget file only declares
 * the three things that actually differ: how to BUILD its element, how to read
 * its CHANGE event, and how to REFLECT a value onto it.
 *
 * It imports NOTHING from waria — it only creates custom-element tags and reads
 * a bubbling `change` CustomEvent. The library is a runtime peer (loaded +
 * initialized by the page); the du-field core stays dependency-free.
 */

import type { Widget, WidgetProps, Choice } from '../../core/contracts';
import { ABSENT } from '../../core/contracts';

/* ------------------------------------------------------------------ *
 * Field chrome — the label/help/preview/errors scaffold shared by every
 * widget, identical to the built-in widgets' so existing CSS applies.
 * ------------------------------------------------------------------ */

export interface Chrome {
  host: HTMLElement;
  control: HTMLElement;
  labelText: HTMLSpanElement;
  help: HTMLDivElement;
  preview: HTMLDivElement;
  errorsEl: HTMLDivElement;
}

function div(className: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  return el;
}

/** Build the chrome once around an already-created control element. */
function buildChrome(host: HTMLElement, control: HTMLElement): Chrome {
  host.textContent = '';
  host.classList.add('du-field');

  const label = document.createElement('label');
  label.className = 'du-field__label';

  const labelText = document.createElement('span');
  labelText.className = 'du-field__label-text';

  control.classList.add('du-field__control');

  const help = div('du-field__help');
  const preview = div('du-field__view');
  const errorsEl = div('du-field__errors');

  label.appendChild(labelText);
  label.appendChild(control);
  host.appendChild(label);
  host.appendChild(help);
  host.appendChild(preview);
  host.appendChild(errorsEl);

  return { host, control, labelText, help, preview, errorsEl };
}

/** Apply label, help, preview, and error chrome — identical for every widget. */
function applyChrome(c: Chrome, props: WidgetProps): void {
  const required = Boolean(props.constraints.required);
  c.labelText.textContent = props.text.label + (required ? ' *' : '');

  c.help.textContent =
    props.text.help && !props.text.help.startsWith('[') ? props.text.help : '';
  c.help.style.display = c.help.textContent ? '' : 'none';

  applyPreview(c.preview, props);

  const showErrors = props.state.touched && props.text.errors.length > 0;
  c.errorsEl.textContent = showErrors ? props.text.errors.join(' ') : '';
  c.errorsEl.style.display = showErrors ? '' : 'none';
  c.host.classList.toggle('du-field--invalid', showErrors);
  c.host.classList.toggle('du-field--valid', props.state.touched && props.state.valid);
}

/** Dual-projection preview (human view + extended projections), as in defaults. */
function applyPreview(preview: HTMLDivElement, props: WidgetProps): void {
  const shown =
    props.state.valid &&
    props.value.canonical !== undefined &&
    props.value.canonical !== ABSENT &&
    props.value.raw.trim() !== '';
  if (!shown) {
    preview.textContent = '';
    preview.style.display = 'none';
    return;
  }
  const parts: string[] = [];
  const view = props.value.view;
  if (typeof view === 'string' && view && view !== props.value.raw) parts.push(view);
  const proj = props.value.projections;
  if (proj) {
    for (const key of Object.keys(proj)) {
      if (key === 'formatted') continue; // already shown as the view
      const v = proj[key];
      parts.push(`${key}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
    }
  }
  preview.textContent = parts.join('  •  ');
  preview.style.display = preview.textContent ? '' : 'none';
}

/* ------------------------------------------------------------------ *
 * Common reactive-prop reflection — disabled + accessible label are named
 * identically on every waria form element.
 * ------------------------------------------------------------------ */

interface CommonProps {
  disabled?: boolean;
  label?: string;
}

/** Reflect the disabled state and accessible label shared by all widgets. */
export function applyCommonProps(control: HTMLElement, props: WidgetProps): void {
  const el = control as HTMLElement & CommonProps;
  el.disabled = Boolean(props.constraints.disabled);
  el.label = props.text.label;
}

/* ------------------------------------------------------------------ *
 * Value coercion — du-field is raw-string-first; waria carries typed props.
 * These translate between the two in both directions.
 * ------------------------------------------------------------------ */

/** A value's choices (for select/choice/toggles), or an empty list. */
export function choicesOf(props: WidgetProps): readonly Choice[] {
  return props.constraints.choices ?? [];
}

/** Stable key for a choice set, to detect when options must be rebuilt. */
export function choicesKey(choices: readonly Choice[]): string {
  return choices.map((c) => c.value).join('');
}

/**
 * Comma-separated representation of the current value, for the string-valued
 * group widgets. Arrays (multi-select → array type) join on ','; everything
 * else falls back to the raw entry. The array type parses this CSV directly.
 */
export function csvValue(props: WidgetProps): string {
  const c = props.value.canonical;
  if (Array.isArray(c)) return c.join(',');
  return props.value.raw ?? '';
}

/** Numeric value for range/spinbutton; falls back when absent/unparseable. */
export function numValue(props: WidgetProps, fallback: number): number {
  const c = props.value.canonical;
  const n = typeof c === 'number' ? c : Number(props.value.raw);
  return Number.isFinite(n) ? n : fallback;
}

/** Parse a numeric constraint string (min/max/step), or undefined. */
export function numAttr(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

interface NumericProps {
  min?: number;
  max?: number;
  step?: number;
  value?: number;
}

/** Reflect numeric bounds + value onto a `w-range`/`w-spinbutton`. Shared. */
export function reflectNumber(control: HTMLElement, props: WidgetProps): void {
  const el = control as HTMLElement & NumericProps;
  const min = numAttr(props.constraints.min);
  const max = numAttr(props.constraints.max);
  const step = numAttr(props.constraints.step);
  if (min !== undefined) el.min = min;
  if (max !== undefined) el.max = max;
  if (step !== undefined) el.step = step;
  el.value = numValue(props, el.min ?? 0);
}

/** Wire the numeric `change` event (`{ value: number }`) + blur→touch. Shared. */
export function bindNumber(
  control: HTMLElement,
  emit: (raw: string) => void,
  touch: () => void,
): void {
  control.addEventListener('change', (e) => {
    const value = (e as CustomEvent<{ value?: number }>).detail?.value;
    if (value !== undefined) emit(String(value));
  });
  control.addEventListener('blur', touch, true);
}

/* ------------------------------------------------------------------ *
 * Option markup builders — the two shapes waria uses for option sets.
 * ------------------------------------------------------------------ */

/**
 * Named-slot options (`w-choice` / `w-toggles`): the option value lives on the
 * `name` of the enclosing `w-slot` (`getSlotName`).
 */
export function buildNamedOptions(
  slotAttr: 'opt' | 'item',
  choices: readonly Choice[],
): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const c of choices) {
    const slot = document.createElement('w-slot');
    slot.setAttribute(slotAttr, '');
    slot.setAttribute('name', c.value);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'du-w__opt';
    btn.textContent = c.value;
    slot.appendChild(btn);
    frag.appendChild(slot);
  }
  return frag;
}

/**
 * Valued-slot options (`w-select`): the option value lives on the `value`
 * attribute of the slotted element itself.
 */
export function buildValueOptions(choices: readonly Choice[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const c of choices) {
    const slot = document.createElement('w-slot');
    slot.setAttribute('opt', '');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('value', c.value);
    btn.className = 'du-w__opt';
    btn.textContent = c.value;
    slot.appendChild(btn);
    frag.appendChild(slot);
  }
  return frag;
}

/**
 * Populate an option container from the current choices, but only when the
 * choice set actually changed (keyed on the host) — so re-renders don't tear
 * down and rebuild option DOM on every keystroke.
 */
export function syncOptions(
  target: HTMLElement,
  choices: readonly Choice[],
  build: (choices: readonly Choice[]) => DocumentFragment,
): void {
  const key = choicesKey(choices);
  if (target.dataset.duChoices === key) return;
  target.textContent = '';
  target.appendChild(build(choices));
  target.dataset.duChoices = key;
}

/** Create a `w-slot[attr]` wrapping a freshly built child element. */
export function slot(attr: string, child: HTMLElement): HTMLElement {
  const s = document.createElement('w-slot');
  s.setAttribute(attr, '');
  s.appendChild(child);
  return s;
}

/** Create a `<button type=button>` with a class (and optional text). */
export function button(className: string, text = ''): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  if (text) btn.textContent = text;
  return btn;
}

/* ------------------------------------------------------------------ *
 * The widget factory — turns a small spec into a du-field Widget.
 * ------------------------------------------------------------------ */

export interface WariaWidgetSpec {
  /** The `use` key authors select with (e.g. `w-switch`). */
  use: string;
  /** Build the waria custom element (with its required slot structure) once. */
  create(props: WidgetProps): HTMLElement;
  /** Wire the element's change event ONCE → translate to a raw du-field input. */
  bind(control: HTMLElement, emit: (raw: string) => void, touch: () => void): void;
  /** Reflect the current value/state onto the element on every render. */
  reflect(control: HTMLElement, props: WidgetProps): void;
}

interface Entry {
  control: HTMLElement;
  chrome: Chrome;
  props: WidgetProps;
}

/**
 * Build a du-field `Widget` from a spec. Handles the host lifecycle (build
 * once, render idempotently), chrome, and event→prop routing; the spec supplies
 * only the waria-specific create/bind/reflect.
 */
export function defineWariaWidget(spec: WariaWidgetSpec): Widget {
  const store = new WeakMap<HTMLElement, Entry>();

  const ensure = (host: HTMLElement, props: WidgetProps): Entry => {
    const existing = store.get(host);
    if (existing) return existing;

    const control = spec.create(props);
    const chrome = buildChrome(host, control);
    const entry: Entry = { control, chrome, props };

    // Wire ONCE; handlers read the latest props off the entry.
    spec.bind(
      control,
      (raw) => entry.props.onInput(raw),
      () => entry.props.onTouch(),
    );

    store.set(host, entry);
    return entry;
  };

  return {
    use: spec.use,
    render(host: HTMLElement, props: WidgetProps): void {
      const entry = ensure(host, props);
      entry.props = props;
      applyChrome(entry.chrome, props);
      applyCommonProps(entry.control, props);
      spec.reflect(entry.control, props);
    },
  };
}
