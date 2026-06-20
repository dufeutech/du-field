/**
 * WARIA BRIDGE — `w-range` (slider), via `use="w-range"`.
 *
 * A numeric slider; bounds come from the field's min/max/step constraints. The
 * component emits `change`/`input` `{ value: number }`; we forward the value as a
 * raw numeric string for the field's numeric type to parse.
 *
 * Structure: `w-slot[rail]` (with a nested `w-slot[fill]`) and `w-slot[knob]`.
 */

import type { Widget } from '../../core/contracts';
import { injectWariaStyles } from './styles';
import { defineWariaWidget, slot, button, reflectNumber, bindNumber } from './helpers';

export function wariaRange(): Widget {
  return defineWariaWidget({
    use: 'w-range',

    create() {
      injectWariaStyles();
      const el = document.createElement('w-range');

      const rail = document.createElement('div');
      rail.className = 'du-w__rail';
      const fill = document.createElement('div');
      fill.className = 'du-w__fill';
      rail.appendChild(slot('fill', fill));

      el.appendChild(slot('rail', rail));
      el.appendChild(slot('knob', button('du-w__knob')));
      return el;
    },

    bind: bindNumber,
    reflect: reflectNumber,
  });
}
