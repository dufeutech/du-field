/**
 * WARIA BRIDGE — `w-toggles` (toggle-button group), via `use="w-toggles"`.
 *
 * Like `w-choice` but rendered as a button group. `multiple` enables multi-select.
 * The component emits `change` with `{ value: string[] }`; we join to a CSV the
 * `array` type parses (or a single value for single-select string fields).
 */

import type { Widget } from '../../core/contracts';
import { injectWariaStyles } from './styles';
import {
  defineWariaWidget,
  choicesOf,
  csvValue,
  syncOptions,
  buildNamedOptions,
} from './helpers';

export function wariaToggles(): Widget {
  return defineWariaWidget({
    use: 'w-toggles',

    create(props) {
      injectWariaStyles();
      const el = document.createElement('w-toggles');
      // Build items before connect so roving-tabindex initializes with them.
      syncOptions(el, choicesOf(props), (cs) => buildNamedOptions('item', cs));
      return el;
    },

    bind(control, emit, touch) {
      control.addEventListener('change', (e) => {
        const value = (e as CustomEvent<{ value?: string[] }>).detail?.value ?? [];
        emit(value.join(','));
      });
      control.addEventListener('blur', touch, true);
    },

    reflect(control, props) {
      const el = control as HTMLElement & { multiple?: boolean; value?: string };
      el.multiple = Boolean(props.constraints.multiple);
      syncOptions(control, choicesOf(props), (cs) => buildNamedOptions('item', cs));
      el.value = csvValue(props);
    },
  });
}
