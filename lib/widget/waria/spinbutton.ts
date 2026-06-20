/**
 * WARIA BRIDGE — `w-spinbutton` (numeric stepper), via `use="w-spinbutton"`.
 *
 * A numeric stepper; bounds come from the field's min/max/step constraints. The
 * component writes the value into the `w-slot[value]` display and emits
 * `change`/`input` `{ value: number }`, which we forward as a raw numeric string.
 *
 * Structure: `w-slot[down]`, `w-slot[value]`, `w-slot[up]`.
 */

import type { Widget } from '../../core/contracts';
import { injectWariaStyles } from './styles';
import { defineWariaWidget, slot, button, reflectNumber, bindNumber } from './helpers';

export function wariaSpinbutton(): Widget {
  return defineWariaWidget({
    use: 'w-spinbutton',

    create() {
      injectWariaStyles();
      const el = document.createElement('w-spinbutton');

      const display = document.createElement('span');
      display.className = 'du-w__num';

      el.appendChild(slot('down', button('du-w__btn', '−'))); // minus sign
      el.appendChild(slot('value', display));
      el.appendChild(slot('up', button('du-w__btn', '+')));
      return el;
    },

    bind: bindNumber,
    reflect: reflectNumber,
  });
}
