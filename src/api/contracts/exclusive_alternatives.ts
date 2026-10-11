/**
 * Types of values that take one of several kinds, each kind with fields of its own, such as a
 * message's content, from which readers read any kind's fields without first telling the kind.
 */

/**
 * Declares fields absent, so that reading them from a value that cannot have them is typed as
 * `undefined`.
 */
export type AbsentFields<FieldName extends PropertyKey> = { readonly [Name in FieldName]?: never };

/** The name of every field of every kind of a map from kinds to their fields. */
export type FieldNameOfAnyKind<FieldsByKind> = {
  [Kind in keyof FieldsByKind]: keyof FieldsByKind[Kind];
}[keyof FieldsByKind];

/**
 * One alternative for each kind of a map from kinds to their fields, which declares the fields
 * of the other kinds absent, so that any of them can be read from a value of unknown kind.
 */
export type ExclusiveAlternatives<FieldsByKind> = {
  [Kind in keyof FieldsByKind]:
    & FieldsByKind[Kind]
    & AbsentFields<Exclude<FieldNameOfAnyKind<FieldsByKind>, keyof FieldsByKind[Kind]>>;
}[keyof FieldsByKind];
