/**
 * WARIA BRIDGE — `w-select` (listbox dropdown), via `use="w-select"`.
 *
 * A single-value dropdown over the field's `choices`. We render a trigger and a
 * listbox, keep the trigger text in sync with the selection, and translate the
 * component's `change` `{ value }` to a raw du-field input.
 *
 * Runs in the component's default portal mode: on open the listbox is teleported
 * to `<body>` (fixed-positioned + stacked) for correct overlay rendering. Because
 * the listbox leaves `w-select` while open, we hold direct references to it rather
 * than re-querying it as a descendant, and its CSS is unscoped so it styles in
 * the portal too.
 *
 * Structure the component expects: a `w-slot[trigger]` and a `w-slot[menu]`
 * whose child is the listbox holding `w-slot[opt]` options carrying `value`.
 */

import type { Widget } from '../../core/contracts';
import { injectWariaStyles } from './styles';
import {
  defineWariaWidget,
  choicesOf,
  syncOptions,
  buildValueOptions,
  slot,
  button,
} from './helpers';

/** Direct references to the parts that move/update, stashed on the element. */
interface SelectParts {
  _duParts?: { listbox: HTMLElement; triggerText: HTMLElement };
}

export function wariaSelect(): Widget {
  return defineWariaWidget({
    use: 'w-select',

    create(props) {
      injectWariaStyles();
      // portal stays at its default (true): the component teleports the listbox
      // to <body> on open. Required — inline (portal=false) renders incorrectly.
      const el = document.createElement('w-select') as HTMLElement & SelectParts;

      const trigger = button('du-w__trigger');
      const triggerText = document.createElement('span');
      triggerText.className = 'du-w__triggerText';
      trigger.appendChild(triggerText);
      el.appendChild(slot('trigger', trigger));

      const listbox = document.createElement('div');
      listbox.className = 'du-w__menu';
      listbox.hidden = true;
      syncOptions(listbox, choicesOf(props), buildValueOptions);
      el.appendChild(slot('menu', listbox));

      // The listbox is teleported out of `el` while open, so re-querying it as a
      // descendant is unreliable — hold direct references instead.
      el._duParts = { listbox, triggerText };
      return el;
    },

    bind(control, emit, touch) {
      control.addEventListener('change', (e) => {
        emit((e as CustomEvent<{ value?: string }>).detail?.value ?? '');
      });
      control.addEventListener('blur', touch, true);
    },

    reflect(control, props) {
      const el = control as HTMLElement & { value?: string; placeholder?: string } & SelectParts;
      const parts = el._duParts;
      if (parts) {
        syncOptions(parts.listbox, choicesOf(props), buildValueOptions);
        parts.triggerText.textContent = props.value.raw || (el.placeholder ?? 'Select…');
      }
      el.value = props.value.raw;
    },
  });
}
