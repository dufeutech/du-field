/**
 * WARIA BRIDGE — minimal functional visuals, injected once.
 *
 * The external library ships unstyled primitives (it owns layout; the author
 * owns aesthetics). These styles give just enough to SEE and operate each
 * control in the playground — toggle thumbs, option buttons, a slider rail/knob.
 * They are keyed off the ARIA state the components maintain, so they track the
 * real value. Authors override them freely; nothing here is load-bearing.
 */

let injected = false;

const CSS = `
  /* Option buttons shared by w-choice / w-toggles / w-select */
  .du-w__opt {
    padding: 0.25em 0.6em; border: 1px solid currentColor; border-radius: 0.4em;
    background: transparent; cursor: pointer; font: inherit; color: inherit;
  }
  .du-w__opt[aria-checked="true"],
  .du-w__opt[aria-pressed="true"],
  .du-w__opt[aria-selected="true"] { background: currentColor; color: Canvas; }
  .du-w__opt[aria-disabled="true"] { opacity: .5; cursor: not-allowed; }

  /* w-switch thumb */
  w-switch .du-w__thumb {
    display: inline-flex; align-items: center; justify-content: flex-start;
    inline-size: 2.5em; block-size: 1.4em; padding: 0.1em;
    border: 1px solid currentColor; border-radius: 1em;
    background: transparent; cursor: pointer; transition: background .12s;
  }
  w-switch .du-w__thumb::before {
    content: ""; inline-size: 1em; block-size: 1em; border-radius: 50%;
    background: currentColor;
  }
  w-switch [aria-pressed="true"].du-w__thumb { justify-content: flex-end; }
  w-switch [aria-disabled="true"].du-w__thumb { opacity: .5; cursor: not-allowed; }

  /* w-select trigger + menu */
  w-select .du-w__trigger {
    display: inline-flex; align-items: center; gap: 0.5em; min-inline-size: 8em;
    padding: 0.3em 0.6em; border: 1px solid currentColor; border-radius: 0.4em;
    background: transparent; cursor: pointer; font: inherit; color: inherit;
  }
  /* Unscoped: the listbox is teleported to <body> (portal mode), so it must not
     depend on a w-select ancestor selector. The :not([hidden]) guard is
     essential — the component shows/hides the listbox via the hidden attribute,
     and a bare display rule would override the UA [hidden] display:none and leave
     the menu permanently open. */
  .du-w__menu:not([hidden]) {
    display: flex; flex-direction: column; gap: 0.2em; padding: 0.3em;
    min-inline-size: 8em;
    border: 1px solid currentColor; border-radius: 0.4em; background: Canvas;
  }

  /* w-range rail / fill / knob */
  w-range { block-size: 1.4em; min-inline-size: 12em; }
  w-range .du-w__rail {
    block-size: 0.3em; border-radius: 1em; background: color-mix(in srgb, currentColor 25%, transparent);
  }
  w-range .du-w__fill { block-size: 0.3em; border-radius: 1em; background: currentColor; }
  w-range .du-w__knob {
    inline-size: 1.1em; block-size: 1.1em; border-radius: 50%;
    border: 1px solid currentColor; background: Canvas; cursor: grab;
  }

  /* w-spinbutton */
  w-spinbutton .du-w__btn {
    inline-size: 1.8em; block-size: 1.8em; border: 1px solid currentColor;
    border-radius: 0.4em; background: transparent; cursor: pointer; font: inherit; color: inherit;
  }
  w-spinbutton .du-w__num { min-inline-size: 2.5em; text-align: center; }
`;

/** Inject the bridge's functional styles once per document. */
export function injectWariaStyles(): void {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const style = document.createElement('style');
  style.dataset.duWaria = '';
  style.textContent = CSS;
  document.head.appendChild(style);
}
