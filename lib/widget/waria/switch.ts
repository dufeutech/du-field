/**
 * WARIA BRIDGE — `w-switch` (boolean), selected via `use="w-switch"`.
 *
 * The component flips its own `pressed` and emits `change` with the new state;
 * we translate that to du-field's raw `'true'`/`'false'`. du-field remains the
 * source of truth — the next render reconciles `pressed` to the canonical value.
 */

import type { Widget } from '../../core/contracts';
import { injectWariaStyles } from './styles';
import { defineWariaWidget, slot, button } from './helpers';

export function wariaSwitch(): Widget {
  return defineWariaWidget({
    use: 'w-switch',

    create() {
      injectWariaStyles();
      const el = document.createElement('w-switch');
      el.appendChild(slot('trigger', button('du-w__thumb')));
      return el;
    },

    bind(control, emit, touch) {
      control.addEventListener('change', (e) => {
        const pressed = (e as CustomEvent<{ pressed?: boolean }>).detail?.pressed ?? false;
        emit(pressed ? 'true' : 'false');
      });
      control.addEventListener('blur', touch, true);
    },

    reflect(control, props) {
      (control as HTMLElement & { pressed?: boolean }).pressed =
        props.value.canonical === true;
    },
  });
}
