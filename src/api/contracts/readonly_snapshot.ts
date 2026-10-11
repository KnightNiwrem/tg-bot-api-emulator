/**
 * A value as a control response carries it: readonly all the way down, so that no nested object or
 * list of it can be changed through its type. The client returns responses as such snapshots, and
 * a route answers with the domain's readonly views of what it shows.
 */
export type ReadonlySnapshot<Value> = Value extends object
  ? { readonly [Member in keyof Value]: ReadonlySnapshot<Value[Member]> }
  : Value;
