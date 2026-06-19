/**
 * OPTIONAL STATE PLUGIN — nanostores backing for the StatePort (RFC §2.14, §3.7).
 *
 * This adapter owns and observes a field's value/state via nanostores atoms,
 * keyed by field identity. It is OPTIONAL and fully removable: the runtime
 * functions without it, and its presence MUST NEVER influence domain logic or
 * canonical output (RFC §3.8). Per RFC §3.7 it treats every FieldSnapshot as
 * OPAQUE domain output — it never reads into, transforms, or mutates the
 * `value` / `state` contents; it only stores, retrieves, and notifies.
 *
 * Beyond the opaque StatePort surface, this adapter additionally EXPOSES the
 * underlying reactive atom per field id via `store(id)`, so framework code can
 * subscribe to a field reactively (the native nanostores way) instead of
 * through the generic `subscribe` callback. The atom is handed out as a
 * `ReadableAtom`: external consumers may observe and read, but writing remains
 * the field lifecycle's responsibility (RFC §3.7 — the plugin never authors
 * canonical state). This is presentation/observation only and cannot influence
 * canonical output (RFC §3.8).
 */

import { atom } from 'nanostores';
import type { WritableAtom, ReadableAtom } from 'nanostores';
import type { StatePort, FieldSnapshot } from '../core/contracts';

/**
 * Internal cell value: a stored snapshot, or `undefined` when an atom was
 * created lazily (by an early subscribe/store) before any snapshot exists.
 */
type Cell = FieldSnapshot | undefined;

/**
 * A StatePort that also exposes its underlying reactive atoms. The extra
 * `store(id)` accessor is additive — a `NanoStatePort` is a valid `StatePort`
 * everywhere, and consumers that don't care about nanostores can ignore it.
 */
export interface NanoStatePort extends StatePort {
  /**
   * The reactive atom holding field `id`'s current snapshot. Lazily created so
   * a consumer can subscribe before the field exists; the value is `undefined`
   * until the field's first snapshot lands. Read-only by contract: observe and
   * `.get()`, but never `.set()` — the field lifecycle owns writes (RFC §3.7).
   */
  store(id: string): ReadableAtom<Cell>;
}

/**
 * Create a StatePort backed by nanostores atoms.
 *
 * Each field id maps to one writable atom holding its current FieldSnapshot.
 * Snapshots are opaque: this plugin passes them through unchanged. The returned
 * port also exposes those atoms via `store(id)` for reactive consumption.
 */
export function createNanoState(): NanoStatePort {
  const atoms = new Map<string, WritableAtom<Cell>>();

  /** Resolve the atom for `id`, lazily creating an empty one if absent. */
  const ensure = (id: string): WritableAtom<Cell> => {
    let store = atoms.get(id);
    if (!store) {
      store = atom<Cell>(undefined);
      atoms.set(id, store);
    }
    return store;
  };

  return {
    create(id, initial) {
      // Seed with `initial`; if an atom already exists (e.g. from an early
      // subscribe), set it instead of replacing the listener-bearing store.
      ensure(id).set(initial);
    },

    set(id, snapshot) {
      // Create lazily so a value can be set before an explicit create().
      ensure(id).set(snapshot);
    },

    get(id) {
      return atoms.get(id)?.get();
    },

    subscribe(id, fn) {
      // Lazily create the atom so listeners can attach before create()/set().
      // nanostores' `subscribe` fires the listener IMMEDIATELY with the
      // atom's current value, and again on every change. That synchronous
      // initial call is acceptable per the StatePort contract (RFC §3.7:
      // notify observers on change). When the atom was created lazily and has
      // no snapshot yet, the current value is `undefined`; we suppress that
      // call and only forward defined FieldSnapshots to the observer.
      return ensure(id).subscribe((snapshot) => {
        if (snapshot !== undefined) {
          fn(snapshot);
        }
      });
    },

    store(id) {
      // Hand out the atom (lazily created) for native reactive consumption.
      // Typed ReadableAtom: a WritableAtom IS a ReadableAtom, so observers get
      // get()/subscribe()/listen() but the writer surface stays internal.
      return ensure(id);
    },
  };
}
