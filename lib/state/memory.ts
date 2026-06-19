/**
 * BUILT-IN STATE PORT — an in-memory `StatePort` (RFC §2.14, §3.7).
 *
 * The runtime functions without any external state layer; this is the default
 * implementation. It is OPAQUE (RFC §3.7): snapshots are stored and handed back
 * exactly as received — never inspected, transformed, or coerced. Its presence
 * or absence MUST NOT change any canonical projection (RFC §3.8).
 */

import type { StatePort, FieldSnapshot } from '../core/contracts';

/**
 * Create an in-memory StatePort backed by a `Map<id, snapshot>` with per-id
 * subscriber sets. `set` overwrites the snapshot and notifies subscribers of
 * that id. `subscribe` returns an unsubscribe function.
 */
export function createMemoryState(): StatePort {
  const snapshots = new Map<string, FieldSnapshot>();
  const subscribers = new Map<string, Set<(snapshot: FieldSnapshot) => void>>();

  function notify(id: string, snapshot: FieldSnapshot): void {
    const subs = subscribers.get(id);
    if (!subs) return;
    // Iterate a copy so an unsubscribe during notification is safe.
    for (const fn of [...subs]) fn(snapshot);
  }

  return {
    create(id: string, initial: FieldSnapshot): void {
      snapshots.set(id, initial);
    },

    set(id: string, snapshot: FieldSnapshot): void {
      snapshots.set(id, snapshot);
      notify(id, snapshot);
    },

    get(id: string): FieldSnapshot | undefined {
      return snapshots.get(id);
    },

    subscribe(id: string, fn: (snapshot: FieldSnapshot) => void): () => void {
      let subs = subscribers.get(id);
      if (!subs) {
        subs = new Set();
        subscribers.set(id, subs);
      }
      subs.add(fn);
      return () => {
        const current = subscribers.get(id);
        if (!current) return;
        current.delete(fn);
        if (current.size === 0) subscribers.delete(id);
      };
    },
  };
}
