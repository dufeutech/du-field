/**
 * CONTEXT ADAPTER (RFC §2.2, §3.8) — the ONE place environment is read.
 *
 * The core forbids ambient reads; determinism requires explicit Context. This
 * adapter sits at the boundary: it samples the environment once and hands the
 * core an explicit Context. Callers may override any field for testing.
 */

import type { Context } from '../core/contracts';

/** Build an explicit Context by sampling the environment, with overrides. */
export function ambientContext(overrides: Partial<Context> = {}): Context {
  let timeZone = overrides.timeZone;
  if (!timeZone) {
    try {
      timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      timeZone = 'UTC';
    }
  }

  let locale = overrides.locale;
  if (!locale) {
    try {
      locale =
        (typeof navigator !== 'undefined' && navigator.language) || 'en';
    } catch {
      locale = 'en';
    }
  }

  return {
    now: overrides.now ?? Date.now(),
    timeZone,
    locale,
  };
}
