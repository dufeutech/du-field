/**
 * REGISTRY — the single resolution path (RFC §2.11, §3.5, §4.8).
 *
 * Maps a (category, name) pair to a single resolved definition. Each category is
 * an independent namespace: a name resolving in one category MUST NOT resolve in
 * another (RFC §3.5). Resolution is deterministic for a given registry state and
 * pure — no I/O, no ambient reads (./rules.md). An unknown name returns
 * `undefined`; the caller decides how to fail (RFC §4.8) — we never substitute an
 * unrelated definition.
 */

import type {
  Registry,
  RegistryCategory,
  TypeDefinition,
} from '../core/contracts';

export function createRegistry(): Registry {
  /**
   * One independent store per category. Keyed by category first, so a name can
   * never leak across categories. Each inner map is the single source for that
   * category's names.
   */
  const stores: Record<RegistryCategory, Map<string, unknown>> = {
    type: new Map<string, unknown>(),
    widget: new Map<string, unknown>(),
    format: new Map<string, unknown>(),
    serializer: new Map<string, unknown>(),
    validator: new Map<string, unknown>(),
  };

  function register(
    category: RegistryCategory,
    name: string,
    value: unknown,
  ): void {
    if (name === '') {
      throw new Error(
        `du-field registry: cannot register an empty name in category "${category}".`,
      );
    }
    // Re-registering the same (category, name) overwrites: extension providers
    // MAY replace defaults (RFC §2.15).
    stores[category].set(name, value);
  }

  function get(category: RegistryCategory, name: string): unknown {
    return stores[category].get(name);
  }

  function has(category: RegistryCategory, name: string): boolean {
    return stores[category].has(name);
  }

  function registerType(def: TypeDefinition): void {
    register('type', def.name, def);
  }

  function getType(name: string): TypeDefinition | undefined {
    return get('type', name) as TypeDefinition | undefined;
  }

  return { register, get, has, registerType, getType };
}
