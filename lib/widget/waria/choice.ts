/**
 * WARIA BRIDGE — `w-choice` (radio / checkbox group), via `use="w-choice"`.
 *
 * Options come from the field's `choices` constraint. `multiple` selects checkbox
 * mode (emits a CSV the `array` type parses directly); otherwise radio mode
 * (single string value). Emits `change` with `{ value: string }` in both cases.
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

export function wariaChoice(): Widget {
  return defineWariaWidget({
    use: 'w-choice',

    create(props) {
      injectWariaStyles();
      const el = document.createElement('w-choice');
      // Build options before the element connects so roving-tabindex/keyboard
      // nav initialize with them present (reflect later re-syncs idempotently).
      syncOptions(el, choicesOf(props), (cs) => buildNamedOptions('opt', cs));
      return el;
    },

    bind(control, emit, touch) {
      control.addEventListener('change', (e) => {
        emit((e as CustomEvent<{ value?: string }>).detail?.value ?? '');
      });
      control.addEventListener('blur', touch, true);
    },

    reflect(control, props) {
      const el = control as HTMLElement & { mode?: string; value?: string };
      el.mode = props.constraints.multiple ? 'checkbox' : 'radio';
      syncOptions(control, choicesOf(props), (cs) => buildNamedOptions('opt', cs));
      el.value = csvValue(props);
    },
  });
}
