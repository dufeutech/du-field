import { useEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
import { du, buildKey, registerWariaWidgets } from '../lib';
import type { DuFieldHandle, DuFormHandle } from '../lib';
// Dev playground only: load the external component library and initialize its
// custom elements so the `<w-switch>`-backed widget can upgrade. Aliased to the
// sibling repo's source in vite.config.ts; never imported by the library build.
import { App as Waria } from '@dufeut/waria';

// The facade IS the entry point: one call wires a runtime with the nanostores
// state adapter as the default and registers <ui-field> + <ui-form>.
du.define();

// Opt-in: register the waria-backed widget set (e.g. use="w-switch") and define
// the external library's custom elements. The built-in widgets are untouched.
registerWariaWidgets(du.registry);
Waria.init();

/* ================================================================== *
 * 1. Headless facade — du.form(...) with NO boilerplate.
 *    Fields are created from a flat name → options map; Preact re-renders off
 *    the facade's reactive subscription (backed by nanostores under the hood).
 * ================================================================== */

const LABELS: Record<string, string> = {
  full_name: 'Full name',
  email: 'Email',
  amount: 'Amount (USD)',
  meeting_date: 'Meeting date',
  meeting_time: 'Meeting time',
};

function useForceUpdate(): () => void {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  return tick as () => void;
}

/** Resolve a field's current errors to human text via the singleton's i18n. */
function errorText(h: DuFieldHandle, locale: string): string {
  return h.state.errors
    .map((e) => du.i18n.resolve(buildKey(h.field.type, 'error', e.code), locale, e.params))
    .join(' · ');
}

function FieldRow({ h }: { h: DuFieldHandle }): preact.JSX.Element {
  const raw = h.field.value.raw;
  const touchedInvalid = !h.valid && raw.length > 0;
  const cls =
    'du-field ' +
    (touchedInvalid ? 'du-field--invalid' : h.valid && raw.length > 0 ? 'du-field--valid' : '');
  const locale = du.context().locale;
  // Pick a native control by the resolved type so date/time get real pickers
  // even on the headless path; canonical still flows through the facade.
  const inputType =
    h.field.type === 'date'
      ? 'date'
      : h.field.type === 'time'
        ? 'time'
        : h.field.type === 'email'
          ? 'email'
          : 'text';
  return (
    <label class={cls}>
      <span class="du-field__label-text">{LABELS[h.name] ?? h.name}</span>
      <input
        class="du-field__control"
        type={inputType}
        value={raw}
        onInput={(e) => h.set((e.currentTarget as HTMLInputElement).value)}
        onBlur={() => h.touch()}
      />
      {h.valid && h.view != null && h.view !== '' && (
        <span class="du-field__view">{String(h.view)}</span>
      )}
      {touchedInvalid && h.state.errors.length > 0 && (
        <span class="du-field__errors">{errorText(h, locale)}</span>
      )}
    </label>
  );
}

function HeadlessDemo(): preact.JSX.Element {
  const force = useForceUpdate();
  // Build the virtual-form once. One flat map → handles that auto-supply context
  // and expose reactive stores. No createRuntime, no explicit Context threading.
  const form: DuFormHandle = useMemo(
    () =>
      du.form({
        full_name: { type: 'string', required: true, min: '2' },
        email: { type: 'email', required: true },
        amount: { type: 'money', currency: 'USD', scale: 2, min: '0' },
        meeting_date: { type: 'date' },
        meeting_time: { type: 'time' },
      }),
    [],
  );

  // Re-render whenever any member field changes (facade subscription).
  useEffect(() => form.subscribe(() => force()), [form]);

  return (
    <>
      <div class="fields">
        {form.fields.map((h) => (
          <FieldRow key={h.id} h={h} />
        ))}
      </div>
      <pre>{`valid: ${form.valid}\n` + JSON.stringify(form.value ?? null, null, 2)}</pre>
    </>
  );
}

/* ================================================================== *
 * 2 & 3. Declarative custom elements — the SAME singleton runtime, now via
 *    markup. du.define() above bound <ui-field>/<ui-form> to it.
 * ================================================================== */

const SHOWCASE = `
  <ui-field name="email" required></ui-field>
  <ui-field name="age" type="int32" min="0" max="120"></ui-field>
  <ui-field name="price" type="money" currency="USD" scale="2" min="0"></ui-field>
  <ui-field name="weight" type="decimal" scale="3" dot-decimal label="Weight (always dot-decimal)"></ui-field>
  <ui-field name="created_at"></ui-field>
  <ui-field name="phone"></ui-field>
  <ui-field name="country" use="input"></ui-field>
  <ui-field name="tags" type="array" use="tags"></ui-field>
  <ui-field name="subscribe" type="bool"></ui-field>
`;

// Every waria-backed input type, selected per field via its `w-*` use key.
const WARIA = `
  <ui-field name="active" type="bool" use="w-switch" label="Active (w-switch)"></ui-field>
  <ui-field name="plan" type="string" use="w-choice" choices="free,pro,team" required label="Plan (w-choice radio)"></ui-field>
  <ui-field name="perms" type="array" use="w-choice" multiple choices="read,write,admin" label="Permissions (w-choice checkbox)"></ui-field>
  <ui-field name="view_mode" type="string" use="w-toggles" choices="list,grid,table" label="View (w-toggles)"></ui-field>
  <ui-field name="region" type="string" use="w-select" choices="US,CA,MX" required label="Region (w-select)"></ui-field>
  <ui-field name="volume" type="int32" use="w-range" min="0" max="100" step="5" label="Volume (w-range)"></ui-field>
  <ui-field name="quantity" type="int32" use="w-spinbutton" min="0" max="20" step="1" label="Quantity (w-spinbutton)"></ui-field>
`;

const FORM = `
  <ui-field name="start" type="date" label="Start date"></ui-field>
  <ui-field name="end" type="date" label="End date"
            valid-if="end >= start" message="End date must be on or after the start date."></ui-field>
  <ui-field name="region" type="string" use="select" choices="US,CA,MX" required label="Region"></ui-field>
  <ui-field name="state" label="State" required-if="region == 'US'" help="Required when region is US"></ui-field>
  <ui-field name="subscribe" type="bool" label="Subscribe to newsletter"></ui-field>
  <ui-field name="newsletter_email" type="email" label="Newsletter email" visible-if="subscribe == true"></ui-field>
`;

export function App() {
  const showcaseRef = useRef<HTMLDivElement>(null);
  const wariaRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const [showcase, setShowcase] = useState<Record<string, unknown>>({});
  const [waria, setWaria] = useState<Record<string, unknown>>({});
  const [form, setForm] = useState<{ valid: boolean; value: unknown }>({
    valid: false,
    value: undefined,
  });

  useEffect(() => {
    const host = showcaseRef.current;
    if (!host) return;
    host.innerHTML = SHOWCASE;
    const collect = (): void => {
      const data: Record<string, unknown> = {};
      host.querySelectorAll('ui-field').forEach((el) => {
        data[el.getAttribute('name') ?? ''] = (el as unknown as { value: unknown }).value;
      });
      setShowcase(data);
    };
    host.addEventListener('du-change', collect);
    collect();
    return () => host.removeEventListener('du-change', collect);
  }, []);

  useEffect(() => {
    const host = wariaRef.current;
    if (!host) return;
    host.innerHTML = WARIA;
    const collect = (): void => {
      const data: Record<string, unknown> = {};
      host.querySelectorAll('ui-field').forEach((el) => {
        data[el.getAttribute('name') ?? ''] = (el as unknown as { value: unknown }).value;
      });
      setWaria(data);
    };
    host.addEventListener('du-change', collect);
    collect();
    return () => host.removeEventListener('du-change', collect);
  }, []);

  useEffect(() => {
    const host = formRef.current;
    if (!host) return;
    host.innerHTML = `<ui-form>${FORM}</ui-form>`;
    const onForm = (e: Event): void => {
      const detail = (e as CustomEvent).detail as { valid: boolean; value: unknown };
      setForm(detail);
    };
    host.addEventListener('du-form-change', onForm);
    return () => host.removeEventListener('du-form-change', onForm);
  }, []);

  return (
    <div class="demo">
      <h1>du-field</h1>
      <p>One primitive. Type, validate, canonicalize, project. Edit a field and watch the canonical output.</p>

      <h2>Headless facade — <code>du.form(&#123;…&#125;)</code></h2>
      <p>
        No runtime wiring, no explicit context. A flat options map becomes a reactive virtual-form;
        nanostores drives the updates. The combined record emits only when valid.
      </p>
      <HeadlessDemo />

      <h2>Type showcase — declarative <code>&lt;ui-field&gt;</code></h2>
      <p>The same singleton runtime, driven by markup (registered via <code>du.define()</code>).</p>
      <div ref={showcaseRef} class="fields" />
      <pre>{JSON.stringify(showcase, null, 2)}</pre>

      <h2>Waria widgets — <code>use="w-*"</code></h2>
      <p>
        Every value-producing waria form component, opt-in per field. Same runtime, same
        canonical output — only the presentational widget differs.
      </p>
      <div ref={wariaRef} class="fields" />
      <pre>{JSON.stringify(waria, null, 2)}</pre>

      <h2>Virtual-form with dependencies</h2>
      <p>
        End ≥ start, state required when region is US, newsletter email shown only when subscribed —
        all declared in markup.
      </p>
      <div ref={formRef} class="fields" />
      <pre>{`valid: ${form.valid}\n` + JSON.stringify(form.value, null, 2)}</pre>
    </div>
  );
}
