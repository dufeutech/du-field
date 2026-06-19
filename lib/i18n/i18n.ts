/**
 * LOCALIZATION LAYER (RFC §2.13, §3.6, §4.6)
 *
 * A pure, deterministic resolver over a flat-key dictionary. Keys in the
 * dictionary are fully-formed as `<type>:<category>[.<code>]:<locale>`. Callers
 * pass a key WITHOUT the locale segment (`<type>:<category>[.<code>]`) plus a
 * locale; the resolver appends the locale and walks a fixed fallback chain.
 *
 * This layer is a runtime projection only: it MUST NOT influence domain logic or
 * canonical output, and it MUST NEVER throw (a missing terminal fallback yields a
 * safe placeholder).
 */

import type {
  I18n,
  Dictionary,
  TextCategory,
  TextBundle,
  Issue,
} from '../core/contracts';

/** Generic sentinel substituted for the `<type>` segment (RFC §3.6). */
const GENERIC_TYPE = '*';

/** Lower-case a locale tag for case-insensitive comparison (RFC §3.6). */
function normalizeLocale(locale: string): string {
  return locale.toLowerCase();
}

/** Primary subtag of a locale tag, e.g. `en-US` → `en` (RFC §4.6). */
function primarySubtag(locale: string): string {
  const dash = locale.indexOf('-');
  return dash === -1 ? locale : locale.slice(0, dash);
}

/** Replace the `<type>` segment of a flat (locale-less) key with the generic sentinel. */
function toGenericKey(key: string): string {
  const colon = key.indexOf(':');
  return colon === -1 ? key : `${GENERIC_TYPE}${key.slice(colon)}`;
}

/**
 * Interpolate `{name}` placeholders using `params`. Missing params leave the
 * placeholder untouched (no throw, no ambient reads).
 */
function interpolate(
  text: string,
  params?: Readonly<Record<string, unknown>>,
): string {
  if (!params) return text;
  return text.replace(/\{([^{}]+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/**
 * Build a flat localization key from a type, category, and optional code.
 * Returns `<type>:<category>` or `<type>:<category>.<code>` (RFC §3.6).
 */
export function buildKey(
  type: string,
  category: TextCategory,
  code?: string,
): string {
  return code === undefined
    ? `${type}:${category}`
    : `${type}:${category}.${code}`;
}

/**
 * Create a deterministic, pure i18n resolver over a flat-key dictionary.
 * `defaultLocale` defaults to `'en'` (RFC §2.13, §4.6).
 */
export function createI18n(
  dict: Dictionary,
  options?: { defaultLocale?: string },
): I18n {
  const defaultLocale = normalizeLocale(options?.defaultLocale ?? 'en');

  /** Look up the dictionary for a locale-less key + a (normalized) locale. */
  function lookup(key: string, locale: string): string | undefined {
    return dict[`${key}:${locale}`];
  }

  /**
   * Try the locale-specific chain (steps 1-3) for one flat key:
   *   exact locale → primary subtag → default locale.
   */
  function resolveForKey(key: string, locale: string): string | undefined {
    const exact = normalizeLocale(locale);
    const direct = lookup(key, exact);
    if (direct !== undefined) return direct;

    const primary = normalizeLocale(primarySubtag(locale));
    if (primary !== exact) {
      const byPrimary = lookup(key, primary);
      if (byPrimary !== undefined) return byPrimary;
    }

    if (defaultLocale !== exact && defaultLocale !== primary) {
      const byDefault = lookup(key, defaultLocale);
      if (byDefault !== undefined) return byDefault;
    }

    return undefined;
  }

  function resolve(
    key: string,
    locale: string,
    params?: Readonly<Record<string, unknown>>,
  ): string {
    // Steps 1-3: type-specific key across locale → primary → default.
    const specific = resolveForKey(key, locale);
    if (specific !== undefined) return interpolate(specific, params);

    // Step 4: generic key (`<type>` → `*`), retrying steps 1-3.
    const generic = resolveForKey(toGenericKey(key), locale);
    if (generic !== undefined) return interpolate(generic, params);

    // Step 5: safe placeholder — never throw (RFC §3.6, §4.6).
    return `[${key}]`;
  }

  return { resolve };
}

/**
 * Build a fully-resolved TextBundle for a field type (RFC §2.13).
 *
 * - `label` ← `buildKey(type, 'label')`
 * - `help`  ← `buildKey(type, 'help')`
 * - `errors`   ← each error Issue mapped to category `'error'` by its code
 * - `warnings` ← each warning Issue mapped to category `'validation'` by its code
 *
 * Each Issue's `params` are interpolated into its resolved message.
 */
export function buildTextBundle(
  type: string,
  i18n: I18n,
  locale: string,
  errors: Issue[],
  warnings: Issue[],
): TextBundle {
  return {
    label: i18n.resolve(buildKey(type, 'label'), locale),
    help: i18n.resolve(buildKey(type, 'help'), locale),
    errors: errors.map((issue) =>
      i18n.resolve(buildKey(type, 'error', issue.code), locale, issue.params),
    ),
    warnings: warnings.map((issue) =>
      i18n.resolve(
        buildKey(type, 'validation', issue.code),
        locale,
        issue.params,
      ),
    ),
  };
}
