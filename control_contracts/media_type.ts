/**
 * Media types as HTTP writes them: the `Content-Type` field of a response, which names one concrete
 * media type with its parameters (RFC 9110 §8.3.1), and the media ranges a contract declares for
 * bytes, which may name every subtype of a type, or every type (RFC 9110 §12.5.1).
 */

/** An HTTP token (RFC 9110 §5.6.2). */
const TOKEN = "[!#$%&'*+.^_`|~0-9A-Za-z-]+";

/**
 * A quoted string (RFC 9110 §5.6.4): `qdtext`, which is any visible character but `"` and `\`, a
 * space, a tab or `obs-text`, and quoted pairs, which escape any of those or `"` and `\`.
 */
const QUOTED_STRING = '"(?:[\\t !#-\\[\\]-~\\x80-\\xff]|\\\\[\\t \\x21-\\x7e\\x80-\\xff])*"';

/** Optional whitespace (RFC 9110 §5.6.3): spaces and tabs. */
const OWS = '[ \\t]*';

/**
 * A `Content-Type` field value: `type "/" subtype`, then any number of `OWS ";" OWS`, each of which
 * may be followed by a parameter `name=value`, whose value is a token or a quoted string, without
 * whitespace around its `=`.
 */
const CONTENT_TYPE_PATTERN = new RegExp(
  `^(${TOKEN})/(${TOKEN})(?:${OWS};${OWS}(?:${TOKEN}=(?:${TOKEN}|${QUOTED_STRING}))?)*$`,
);

/** A media range as a contract declares it: `type/subtype`, without parameters. */
const MEDIA_RANGE_PATTERN = new RegExp(`^(${TOKEN})/(${TOKEN})$`);

/** The wildcard that a media range writes for any type or subtype. */
const MEDIA_RANGE_WILDCARD = '*';

/** A media type's type and subtype, in lowercase, as they compare without regard to letter case. */
type MediaTypeName = readonly [type: string, subtype: string];

/**
 * The type and subtype of a `Content-Type` field value: one concrete media type, whose type and
 * subtype are no wildcard, followed by well-formed parameters; `undefined` for any other text.
 */
function readContentType(fieldValue: string): MediaTypeName | undefined {
  const match = CONTENT_TYPE_PATTERN.exec(fieldValue);
  if (match === null) return undefined;
  const type = match[1].toLowerCase();
  const subtype = match[2].toLowerCase();
  return type === MEDIA_RANGE_WILDCARD || subtype === MEDIA_RANGE_WILDCARD
    ? undefined
    : [type, subtype];
}

/**
 * The type and subtype of a declared media range: `type/subtype`, `type/*`, or the range of every
 * media type, whose type is a wildcard only with its subtype; `undefined` for any other text.
 */
function readMediaRange(text: string): MediaTypeName | undefined {
  const match = MEDIA_RANGE_PATTERN.exec(text);
  if (match === null) return undefined;
  const type = match[1].toLowerCase();
  const subtype = match[2].toLowerCase();
  return type === MEDIA_RANGE_WILDCARD && subtype !== MEDIA_RANGE_WILDCARD
    ? undefined
    : [type, subtype];
}

/** Whether text is a media range a contract may declare for bytes, such as `image/*`. */
export function isMediaRange(text: string): boolean {
  return readMediaRange(text) !== undefined;
}

/**
 * Whether a `Content-Type` field value is well formed and names a media type within a media
 * range: equal to it, of its type when the range is `type/*`, or any when it is every type's.
 * Types and subtypes compare without regard to letter case; parameters, such as `charset`, do not
 * take part.
 */
export function isContentTypeInRange(fieldValue: string, mediaRange: string): boolean {
  const mediaType = readContentType(fieldValue);
  const range = readMediaRange(mediaRange);
  if (mediaType === undefined || range === undefined) return false;
  const [type, subtype] = mediaType;
  const [rangeType, rangeSubtype] = range;
  if (rangeType === MEDIA_RANGE_WILDCARD) return true;
  return rangeType === type && (rangeSubtype === MEDIA_RANGE_WILDCARD || rangeSubtype === subtype);
}
