// Type-level checks that a local wire type conforms to an independent reference type of the same
// JSON object. They compare JSON shapes, not TypeScript guarantees: `readonly` does not change what
// is serialized, so it is removed from the local type first, and a key the reference lacks is a
// failure even though TypeScript's assignability allows extra keys.

type JsonPrimitive = string | number | boolean | null | undefined;

/** The type with `readonly` removed from its properties and arrays, at every depth. */
export type DeepMutable<Type> = Type extends JsonPrimitive ? Type
  : Type extends readonly (infer Element)[] ? DeepMutableArray<Element>
  : { -readonly [Key in keyof Type]: DeepMutable<Type[Key]> };

// An interface, unlike a mapped array type, defers its element type, so that a recursive type such
// as rich text, which holds arrays of itself, does not expand without end.
interface DeepMutableArray<Element> extends Array<DeepMutable<Element>> {}

/** Whether two types are identical, not merely assignable to each other. */
export type IsExactly<Left, Right> = (<Probe>() => Probe extends Left ? 1 : 2) extends
  (<Probe>() => Probe extends Right ? 1 : 2) ? true : false;

/**
 * Compiles only when the condition is `true`; for a failing `Conformance`, the error shows the
 * paths that fail.
 */
export type ExpectTrue<Condition extends true> = Condition;

/**
 * A known difference between a reference type and the JSON the emulator emits: the emulator's
 * output follows `Override` wherever the reference describes `Target`. It applies to `Target`
 * itself and to every reference type that extends it with all of its keys, such as an intersection
 * with it, so a deviation of grammY's `Message` also applies to `Message & Update.NonChannel`.
 */
export type ReferenceDeviation<Target extends object, Override extends object> = readonly [
  Target,
  Override,
];

/**
 * Whether a local wire type conforms to its reference type, given the reference's known
 * deviations: `true` when, without `readonly`, it is assignable to the reference and declares no
 * key the reference lacks, at any depth. Otherwise it names the paths that fail.
 */
export type Conformance<Local, Reference, Deviations = never> = ConformanceToShape<
  Local,
  JsonShape<Reference, Deviations>
>;

/** The paths a failing `Conformance` names; `never` for a passing one. */
export type FailingPaths<Result> = Result extends true ? never : keyof Result & string;

type ConformanceToShape<Local, ReferenceShape> = [DeepMutable<Local>] extends [ReferenceShape]
  ? [UnknownKeyPaths<Local, ReferenceShape>] extends [never] ? true
  : { readonly [Path in UnknownKeyPaths<Local, ReferenceShape>]: 'not declared by the reference' }
  : {
    readonly [Path in IncompatibleValuePaths<Local, ReferenceShape>]: 'missing or not assignable';
  };

/**
 * The JSON objects a reference type describes, with its deviations applied at every depth. A
 * property whose only value is `undefined` stands for an absent key, as in grammY's
 * `Message & { reply_to_message: undefined }`, so it becomes optional.
 */
export type JsonShape<Type, Deviations = never> = Type extends JsonPrimitive ? Type
  : Type extends readonly (infer Element)[] ? JsonShapeArray<Element, Deviations>
  : ObjectJsonShape<Deviated<Type, OverridesFor<Type, Deviations>>, Deviations>;

type ObjectJsonShape<Type, Deviations> =
  & {
    [Key in keyof Type as OnlyUndefined<Type[Key]> extends true ? never : Key]: JsonShape<
      Type[Key],
      Deviations
    >;
  }
  & { [Key in keyof Type as OnlyUndefined<Type[Key]> extends true ? Key : never]?: undefined };

// An interface for the reason `DeepMutableArray` is one.
interface JsonShapeArray<Element, Deviations> extends Array<JsonShape<Element, Deviations>> {}

/** The overrides of the deviations whose target the reference object type is or extends. */
type OverridesFor<Type, Deviations> = Deviations extends
  ReferenceDeviation<infer Target, infer Override>
  ? [keyof Target] extends [keyof Type] ? [Type] extends [Target] ? Override : never : never
  : never;

type Deviated<Type, Overrides> = [Overrides] extends [never] ? Type
  : Omit<Type, KeysOfAnyMember<Overrides>> & IntersectionOf<Overrides>;

type IntersectionOf<Union> = (Union extends unknown ? (member: Union) => void : never) extends
  (member: infer Intersection) => void ? Intersection
  : never;

type OnlyUndefined<Type> = [Type] extends [undefined] ? [undefined] extends [Type] ? true : false
  : false;

/**
 * The paths of keys that the local type declares but the reference type does not, at every depth;
 * `never` when there are none. Each member of a local union is compared with the reference members
 * it is assignable to, so a key is checked against the variant it belongs to. Array elements add
 * `[]` to the path.
 */
export type UnknownKeyPaths<Local, Reference, Path extends string = '', Enclosing = never> =
  IsEnclosed<Local, Enclosing> extends true ? never
    : EachMemberUnknownKeyPaths<Local, Reference, Path, Enclosing | readonly [Local]>;

type EachMemberUnknownKeyPaths<Local, Reference, Path extends string, Enclosing> =
  ComparedMembers<Local, Reference> extends infer LocalMember
    ? LocalMember extends unknown ? MemberUnknownKeyPaths<LocalMember, Reference, Path, Enclosing>
    : never
    : never;

type MemberUnknownKeyPaths<LocalMember, Reference, Path extends string, Enclosing> =
  LocalMember extends JsonPrimitive ? never
    : LocalMember extends readonly unknown[] ? UnknownKeyPaths<
        LocalMember[number],
        ArrayMembers<Reference>[number],
        `${Path}[]`,
        Enclosing
      >
    : ObjectUnknownKeyPaths<
      LocalMember,
      KeyComparedMembers<LocalMember, ObjectMembers<Reference>>,
      Path,
      Enclosing
    >;

type ObjectUnknownKeyPaths<LocalObject, ReferenceObjects, Path extends string, Enclosing> = {
  [Key in DeclaredKeys<LocalObject>]-?: Key extends KeysOfAnyMember<ReferenceObjects>
    ? UnknownKeyPaths<
      NonNullable<LocalObject[Key]>,
      NonNullable<ValuesOfAnyMember<ReferenceObjects, Key>>,
      KeyPath<Path, Key>,
      Enclosing
    >
    : KeyPath<Path, Key>;
}[DeclaredKeys<LocalObject>];

/**
 * The reference members whose keys a local object is compared with: those it is assignable to, or,
 * when there are none, its likely counterparts, whose mismatched values the value check reports.
 */
type KeyComparedMembers<LocalObject, ReferenceObjects> =
  [AssignableMembers<LocalObject, ReferenceObjects>] extends [never]
    ? LikelyCounterparts<LocalObject, ReferenceObjects>
    : AssignableMembers<LocalObject, ReferenceObjects>;

/**
 * The paths at which the local type, without `readonly`, is not assignable to the reference type:
 * a required key it lacks, or a value of another type; `(whole value)` stands for the root. Where
 * the reference offers variants, the path continues into the likely counterpart of each local
 * member, and ends when there is no single one.
 */
export type IncompatibleValuePaths<Local, Reference, Path extends string = '', Enclosing = never> =
  IsEnclosed<Local, Enclosing> extends true ? never
    : EachMemberIncompatibleValuePaths<Local, Reference, Path, Enclosing | readonly [Local]>;

type EachMemberIncompatibleValuePaths<Local, Reference, Path extends string, Enclosing> =
  ComparedMembers<Local, Reference> extends infer LocalMember
    ? LocalMember extends unknown
      ? MemberIncompatibleValuePaths<LocalMember, Reference, Path, Enclosing>
    : never
    : never;

type MemberIncompatibleValuePaths<LocalMember, Reference, Path extends string, Enclosing> =
  [DeepMutable<LocalMember>] extends [Reference] ? never
    : LocalMember extends readonly unknown[]
      ? [ArrayMembers<Reference>] extends [never] ? PathOrWholeValue<Path>
      : IncompatibleValuePaths<
        LocalMember[number],
        ArrayMembers<Reference>[number],
        `${Path}[]`,
        Enclosing
      >
    : LocalMember extends JsonPrimitive ? PathOrWholeValue<Path>
    : SingleMemberOrNever<LikelyCounterparts<LocalMember, ObjectMembers<Reference>>> extends
      infer Counterpart ? [Counterpart] extends [never] ? PathOrWholeValue<Path>
      : OrWholeValue<
        ObjectIncompatibleValuePaths<
          LocalMember,
          Counterpart,
          Path,
          Enclosing
        >,
        Path
      >
    : never;

type ObjectIncompatibleValuePaths<LocalObject, ReferenceObject, Path extends string, Enclosing> =
  | {
    [Key in RequiredKeys<ReferenceObject> & string]: Key extends keyof LocalObject ? never
      : KeyPath<Path, Key>;
  }[RequiredKeys<ReferenceObject> & string]
  | {
    [Key in keyof LocalObject & keyof ReferenceObject & string]-?: IncompatibleValuePaths<
      LocalObject[Key],
      ReferenceObject[Key],
      KeyPath<Path, Key>,
      Enclosing
    >;
  }[keyof LocalObject & keyof ReferenceObject & string];

/**
 * The members of a local union, compared one by one. A member whose tag, such as `type`, admits
 * several values that stand for several reference members, as `'paragraph' | 'footer'` does, is
 * compared as one member for each value.
 */
type ComparedMembers<Local, Reference> = Local extends JsonPrimitive | readonly unknown[] ? Local
  : IsUnion<LikelyCounterparts<Local, ObjectMembers<Reference>>> extends true
    ? SplitOnTag<Local, TagKeysWithSeveralValues<Local>>
  : Local;

type TagKeysWithSeveralValues<LocalObject> = {
  [Key in keyof LocalObject]-?: IsLiteral<LocalObject[Key]> extends true
    ? IsUnion<LocalObject[Key]> extends true ? Key : never
    : never;
}[keyof LocalObject];

/** The object as one member for each value of its tag, when it has exactly one such tag. */
type SplitOnTag<LocalObject, TagKey extends keyof LocalObject> = [TagKey] extends [never]
  ? LocalObject
  : IsUnion<TagKey> extends true ? LocalObject
  : LocalObject[TagKey] extends infer TagValue
    ? TagValue extends unknown ? Omit<LocalObject, TagKey> & { readonly [Key in TagKey]: TagValue }
    : never
  : never;

type ArrayMembers<Type> = Extract<Type, readonly unknown[]>;

type ObjectMembers<Type> = Exclude<Type, JsonPrimitive | readonly unknown[]>;

/** The keys an object type names, without those of an index signature such as `Record<string, T>`. */
type DeclaredKeys<Type> = keyof {
  [Key in keyof Type & string as string extends Key ? never : Key]: Type[Key];
};

/** Every key of any member of a union, where `keyof` gives only the keys all members share. */
type KeysOfAnyMember<Type> = Type extends unknown ? keyof Type : never;

/** The values a key has in the members of a union that declare it. */
type ValuesOfAnyMember<Type, Key extends PropertyKey> = Type extends unknown
  ? Key extends keyof Type ? Type[Key] : never
  : never;

type RequiredKeys<Type> = {
  [Key in keyof Type]-?: Record<never, never> extends Pick<Type, Key> ? never : Key;
}[keyof Type];

type AssignableMembers<LocalObject, ReferenceObjects> = ReferenceObjects extends unknown
  ? [DeepMutable<LocalObject>] extends [ReferenceObjects] ? ReferenceObjects : never
  : never;

/**
 * The reference members a local object most likely stands for: those whose literal values, such as
 * a `type` tag, it matches, narrowed to those whose required keys it declares when any do.
 */
type LikelyCounterparts<LocalObject, ReferenceObjects> = NonEmptyOr<
  MembersWithDeclaredRequiredKeys<LocalObject, MatchingTagMembers<LocalObject, ReferenceObjects>>,
  MatchingTagMembers<LocalObject, ReferenceObjects>
>;

type NonEmptyOr<Type, Fallback> = [Type] extends [never] ? Fallback : Type;

type MatchingTagMembers<LocalObject, ReferenceObjects> = ReferenceObjects extends unknown
  ? [MismatchedTagKeys<LocalObject, ReferenceObjects>] extends [never] ? ReferenceObjects : never
  : never;

type MismatchedTagKeys<LocalObject, ReferenceObject> = {
  [Key in keyof LocalObject & keyof ReferenceObject]-?: IsLiteral<ReferenceObject[Key]> extends true
    ? [
      | Extract<LocalObject[Key], ReferenceObject[Key]>
      | Extract<ReferenceObject[Key], LocalObject[Key]>,
    ] extends [never] ? Key
    : never
    : never;
}[keyof LocalObject & keyof ReferenceObject];

type MembersWithDeclaredRequiredKeys<LocalObject, ReferenceObjects> = ReferenceObjects extends
  unknown
  ? [Exclude<RequiredKeys<ReferenceObjects>, keyof LocalObject>] extends [never] ? ReferenceObjects
  : never
  : never;

/** Whether a type admits only literal values, such as `'private'` or `true`. */
type IsLiteral<Type> = [Type] extends [never] ? false
  : [Type] extends [string] ? string extends Type ? false : true
  : [Type] extends [number] ? number extends Type ? false : true
  : [Type] extends [boolean] ? boolean extends Type ? false : true
  : false;

type SingleMemberOrNever<Type> = IsUnion<Type> extends true ? never : Type;

type IsUnion<Type, Whole = Type> = Type extends unknown ? [Whole] extends [Type] ? false : true
  : never;

/**
 * Whether a local type already encloses itself on the path being compared, as a recursive type
 * does; its counterpart there is then the same reference type, already being compared.
 */
type IsEnclosed<Local, Enclosing> = true extends (
  Enclosing extends readonly [infer EnclosingType] ? IsExactly<EnclosingType, Local>
    : never
) ? true
  : false;

type KeyPath<Path extends string, Key extends string> = Path extends '' ? Key : `${Path}.${Key}`;

type PathOrWholeValue<Path extends string> = Path extends '' ? '(whole value)' : Path;

/** The paths found, or the path itself when an object mismatch shows in none of its keys. */
type OrWholeValue<Paths extends string, Path extends string> = [Paths] extends [never]
  ? PathOrWholeValue<Path>
  : Paths;
