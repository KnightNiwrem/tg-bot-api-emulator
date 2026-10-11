import type { ChangeStaging } from './change_staging.ts';

/**
 * A `Map` whose writes take part in its session's transactions, as `ChangeStaging` describes. A
 * transaction that aborts leaves the map exactly as it was, its iteration order included, which
 * decides, for example, the order in which a chat's members receive updates.
 *
 * Values are never `undefined`, so `get` tells a missing entry apart from a stored one.
 */
export class TransactionalMap<Key, Value extends NonNullable<unknown>>
  implements ReadonlyMap<Key, Value> {
  readonly #staging: ChangeStaging;
  readonly #entries: Map<Key, Value>;

  /**
   * `initialEntries` belong to the new map from the start: a transaction that aborts after
   * creating it forgets the map itself, through the write that stored it.
   */
  constructor(staging: ChangeStaging, initialEntries: Iterable<readonly [Key, Value]> = []) {
    this.#staging = staging;
    this.#entries = new Map(initialEntries);
  }

  get size(): number {
    return this.#entries.size;
  }

  get(key: Key): Value | undefined {
    return this.#entries.get(key);
  }

  has(key: Key): boolean {
    return this.#entries.has(key);
  }

  set(key: Key, value: Value): this {
    const replacedValue = this.#entries.get(key);
    this.#entries.set(key, value);
    // A new key is the newest entry, and every later write is reverted first, so removing it
    // restores the order; a replaced value keeps its key's place.
    this.#staging.recordRevert(
      replacedValue === undefined
        ? () => this.#entries.delete(key)
        : () => this.#entries.set(key, replacedValue),
    );
    return this;
  }

  /** Removes an entry; returns false when there was none. */
  delete(key: Key): boolean {
    if (!this.#entries.has(key)) {
      return false;
    }
    // Putting a removed key back appends it, so a revert restores every entry in its order.
    const entriesBeforeDeletion = this.#staging.isStaging ? [...this.#entries] : [];
    this.#entries.delete(key);
    this.#staging.recordRevert(() => replaceEntries(this.#entries, entriesBeforeDeletion));
    return true;
  }

  forEach(
    callback: (value: Value, key: Key, map: ReadonlyMap<Key, Value>) => void,
    thisArg?: unknown,
  ): void {
    this.#entries.forEach((value, key) => callback.call(thisArg, value, key, this));
  }

  entries(): MapIterator<[Key, Value]> {
    return this.#entries.entries();
  }

  keys(): MapIterator<Key> {
    return this.#entries.keys();
  }

  values(): MapIterator<Value> {
    return this.#entries.values();
  }

  [Symbol.iterator](): MapIterator<[Key, Value]> {
    return this.#entries[Symbol.iterator]();
  }
}

/**
 * A `Set` whose writes take part in its session's transactions, as `ChangeStaging` describes. A
 * transaction that aborts leaves the set exactly as it was, its iteration order included.
 */
export class TransactionalSet<Value> {
  readonly #staging: ChangeStaging;
  readonly #values = new Set<Value>();

  constructor(staging: ChangeStaging) {
    this.#staging = staging;
  }

  get size(): number {
    return this.#values.size;
  }

  has(value: Value): boolean {
    return this.#values.has(value);
  }

  add(value: Value): this {
    if (!this.#values.has(value)) {
      this.#values.add(value);
      // The value is the newest, and every later write is reverted first.
      this.#staging.recordRevert(() => this.#values.delete(value));
    }
    return this;
  }

  /** Removes a value; returns false when the set did not hold it. */
  delete(value: Value): boolean {
    if (!this.#values.has(value)) {
      return false;
    }
    const valuesBeforeDeletion = this.#staging.isStaging ? [...this.#values] : [];
    this.#values.delete(value);
    this.#staging.recordRevert(() => {
      this.#values.clear();
      for (const restoredValue of valuesBeforeDeletion) {
        this.#values.add(restoredValue);
      }
    });
    return true;
  }

  values(): SetIterator<Value> {
    return this.#values.values();
  }

  [Symbol.iterator](): SetIterator<Value> {
    return this.#values[Symbol.iterator]();
  }
}

function replaceEntries<Key, Value>(
  map: Map<Key, Value>,
  entries: readonly (readonly [Key, Value])[],
): void {
  map.clear();
  for (const [key, value] of entries) {
    map.set(key, value);
  }
}
