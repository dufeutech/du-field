/**
 * WARIA BRIDGE — optional widget set backed by the external component library.
 *
 * A SEPARATE, opt-in adapter: importing it pulls in no external code (each widget
 * only creates custom-element tags and bridges a `change` event; the library is a
 * runtime peer, loaded + initialized by the host page). Register the set on a
 * runtime's registry to make the `w-*` use keys resolvable:
 *
 *   import { registerWariaWidgets } from 'du-field'; // re-exported from the entry
 *   registerWariaWidgets(du.registry);
 *   // then, per field: <ui-field name="size" type="int32" use="w-range"></ui-field>
 *
 * Every widget uses a distinct `w-*` use key, so the built-in defaults remain the
 * resolution for `switch`/`select`/etc. — selection is per field, never a global
 * override.
 *
 * Coverage maps each waria value-producing form component to a du-field type:
 *   w-switch     → bool
 *   w-choice     → string (radio) / array (checkbox, via `multiple`)
 *   w-toggles    → string (single) / array (via `multiple`)
 *   w-select     → string with `choices`
 *   w-range      → numeric (int32/decimal/money…), bounds from min/max/step
 *   w-spinbutton → numeric, bounds from min/max/step
 */

import type { Registry, Widget } from '../../core/contracts';
import { wariaSwitch } from './switch';
import { wariaChoice } from './choice';
import { wariaToggles } from './toggles';
import { wariaSelect } from './select';
import { wariaRange } from './range';
import { wariaSpinbutton } from './spinbutton';

export { wariaSwitch } from './switch';
export { wariaChoice } from './choice';
export { wariaToggles } from './toggles';
export { wariaSelect } from './select';
export { wariaRange } from './range';
export { wariaSpinbutton } from './spinbutton';
export { defineWariaWidget } from './helpers';
export type { WariaWidgetSpec } from './helpers';

/** The opt-in waria-backed widget set, keyed by `w-*` use values. */
export const wariaWidgets: Widget[] = [
  wariaSwitch(),
  wariaChoice(),
  wariaToggles(),
  wariaSelect(),
  wariaRange(),
  wariaSpinbutton(),
];

/** Register every waria-backed widget on a runtime's registry. */
export function registerWariaWidgets(registry: Registry): void {
  for (const w of wariaWidgets) registry.register('widget', w.use, w);
}
