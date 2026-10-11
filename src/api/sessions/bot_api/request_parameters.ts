import { z } from 'zod';

/**
 * Bot API method parameters by name. Telegram transmits every parameter as text, whichever
 * encoding carries it, so method schemas parse values from strings.
 */
export type BotApiRequestParameters = Readonly<Record<string, string>>;

/** A file uploaded in a multipart request, under the name its sender gave it. */
export interface BotApiUploadedFile {
  readonly fileName: string;
  readonly content: Uint8Array<ArrayBuffer>;
}

/** Files uploaded in a multipart request, by the name of the part that carries each. */
export type BotApiUploadedFiles = ReadonlyMap<string, BotApiUploadedFile>;

export type BotApiRequestParametersDecoding =
  | {
    readonly decoded: true;
    readonly parameters: BotApiRequestParameters;
    readonly uploadedFiles: BotApiUploadedFiles;
  }
  | { readonly decoded: false; readonly description: string };

const JSON_MEDIA_TYPE = 'application/json';
const URL_ENCODED_FORM_MEDIA_TYPE = 'application/x-www-form-urlencoded';
const MULTIPART_FORM_MEDIA_TYPE = 'multipart/form-data';

const DECIMAL_INTEGER_PATTERN = /^-?\d+$/;
const DECIMAL_NUMBER_PATTERN = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
/** Spellings that Telegram's `to_bool` reads as true, compared after trimming and lowercasing. */
const TRUE_BOOLEAN_TEXTS = ['true', 'yes', '1'] as const;
const FALSE_BOOLEAN_TEXTS = ['false', 'no', '0'] as const;

/**
 * Collects parameters from the query string and the body, as the official Bot API server's
 * `HttpReader` does. A query-string parameter takes precedence over a body parameter of the same
 * name, because Telegram reads the query string first and uses the first occurrence.
 *
 * A JSON body's string member is used as its content, and any other member as its source text,
 * exactly as the bot wrote it, so `2` and `"2"` are equivalent, as are `["message"]` and
 * `"[\"message\"]"`. Every encoding thus yields the same text for a parameter whose value the bot
 * spelled the same way: JSON text in a form field, in the query string, or as a JSON body's member
 * is read character for character, whitespace and member order included, and only the encoding's
 * own escaping is undone.
 *
 * A JSON body's member other than a string is refused, as Telegram refuses it, if it nests deeper
 * than `BOT_API_JSON_MAX_DEPTH` allows, before any method reads it.
 *
 * A multipart body can also upload files, which methods that send files read by part name; as on
 * Telegram, the first file of a name counts, and other methods ignore files.
 *
 * Telegram ignores a body it cannot parse or whose content type it does not decode; rejecting it
 * instead surfaces the bot's mistake in tests.
 */
export async function decodeBotApiRequestParameters(
  request: Request,
): Promise<BotApiRequestParametersDecoding> {
  const parameterEntries: Array<readonly [string, string]> = [
    ...new URL(request.url).searchParams,
  ];

  const bodyDecoding = await decodeBodyParameterEntries(request);
  if (!bodyDecoding.decoded) {
    return bodyDecoding;
  }
  return collectParameters(
    [...parameterEntries, ...bodyDecoding.parameterEntries],
    bodyDecoding.uploadedFiles,
  );
}

/**
 * Collects parameters from a message body alone, as `decodeBotApiRequestParameters` reads a
 * request's body. The official Bot API server reads a webhook's response to an update this way,
 * for the method the webhook may name in it.
 */
export async function decodeBotApiBodyParameters(
  message: Request | Response,
): Promise<BotApiRequestParametersDecoding> {
  const bodyDecoding = await decodeBodyParameterEntries(message);
  return bodyDecoding.decoded
    ? collectParameters(bodyDecoding.parameterEntries, bodyDecoding.uploadedFiles)
    : bodyDecoding;
}

/** Keeps the first value of each parameter name, as Telegram does. */
function collectParameters(
  parameterEntries: ReadonlyArray<readonly [string, string]>,
  uploadedFiles: BotApiUploadedFiles,
): BotApiRequestParametersDecoding {
  const parameters = new Map<string, string>();
  for (const [name, value] of parameterEntries) {
    if (!parameters.has(name)) {
      parameters.set(name, value);
    }
  }
  return { decoded: true, parameters: Object.fromEntries(parameters), uploadedFiles };
}

type BodyParameterEntriesDecoding =
  | {
    readonly decoded: true;
    readonly parameterEntries: ReadonlyArray<readonly [string, string]>;
    readonly uploadedFiles: BotApiUploadedFiles;
  }
  | { readonly decoded: false; readonly description: string };

const NO_UPLOADED_FILES: BotApiUploadedFiles = new Map();

async function decodeBodyParameterEntries(
  message: Request | Response,
): Promise<BodyParameterEntriesDecoding> {
  const mediaType = message.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase();

  if (mediaType === MULTIPART_FORM_MEDIA_TYPE) {
    let formData: FormData;
    try {
      formData = await message.formData();
    } catch {
      return { decoded: false, description: 'Bad Request: invalid multipart/form-data body' };
    }
    const parameterEntries: Array<readonly [string, string]> = [];
    const uploadedFiles = new Map<string, BotApiUploadedFile>();
    for (const [name, value] of formData) {
      if (typeof value === 'string') {
        parameterEntries.push([name, value]);
      } else if (!uploadedFiles.has(name)) {
        uploadedFiles.set(name, {
          fileName: value.name,
          content: new Uint8Array(await value.arrayBuffer()),
        });
      }
    }
    return { decoded: true, parameterEntries, uploadedFiles };
  }

  const body = await message.text();
  if (body.length === 0) {
    return { decoded: true, parameterEntries: [], uploadedFiles: NO_UPLOADED_FILES };
  }
  if (mediaType === URL_ENCODED_FORM_MEDIA_TYPE) {
    return {
      decoded: true,
      parameterEntries: [...new URLSearchParams(body)],
      uploadedFiles: NO_UPLOADED_FILES,
    };
  }
  if (mediaType === JSON_MEDIA_TYPE) {
    return decodeJsonObjectParameterEntries(body);
  }
  return {
    decoded: false,
    description:
      `Bad Request: unsupported Content-Type; use ${JSON_MEDIA_TYPE}, ${URL_ENCODED_FORM_MEDIA_TYPE}, or ${MULTIPART_FORM_MEDIA_TYPE}`,
  };
}

/**
 * Reads a JSON object's members as parameters, as the official Bot API server's `HttpReader` does:
 * a string as its content, and any other value as its source text, exactly as the bot wrote it.
 * So every number keeps its spelling, whether it is a member or nested in one: 64-bit identifiers
 * such as `draft_id` stay exact beyond the integers a JavaScript number holds, and `1e500` and
 * `1.0` stay as they are. Every member counts, in source order, so the first of a repeated name
 * wins, as among form fields.
 */
function decodeJsonObjectParameterEntries(body: string): BodyParameterEntriesDecoding {
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(body);
  } catch {
    return { decoded: false, description: 'Bad Request: invalid JSON body' };
  }
  if (typeof parsedBody !== 'object' || parsedBody === null || Array.isArray(parsedBody)) {
    return { decoded: false, description: 'Bad Request: JSON object expected' };
  }
  const parameterEntries = readJsonObjectMemberTexts(body);
  if (parameterEntries === undefined) {
    return {
      decoded: false,
      description: "Bad Request: can't parse parameter value: Too big object depth",
    };
  }
  return { decoded: true, parameterEntries, uploadedFiles: NO_UPLOADED_FILES };
}

/**
 * Each member of a JSON object's text, in source order, as its name and the text of its value: a
 * string's content, or the source text of any other value, without the whitespace around it; or
 * `undefined` if a member other than a string nests deeper than `BOT_API_JSON_MAX_DEPTH` allows,
 * as `HttpReader::parse_json_parameters` checks with `do_json_skip`. `objectText` must be a JSON
 * object, as `JSON.parse` has checked, so that the scan needs no checks of its own. The scan keeps
 * no stack, so no nesting depth can overflow the call stack.
 */
function readJsonObjectMemberTexts(
  objectText: string,
): Array<readonly [string, string]> | undefined {
  const memberTexts: Array<readonly [string, string]> = [];
  // Past the object's opening brace.
  let position = skipJsonWhitespace(objectText, skipJsonWhitespace(objectText, 0) + 1);
  while (objectText[position] !== '}') {
    const nameEnd = jsonStringEnd(objectText, position);
    const name = decodeJsonString(objectText.slice(position, nameEnd));
    // Past the colon after the name.
    const valueStart = skipJsonWhitespace(objectText, skipJsonWhitespace(objectText, nameEnd) + 1);
    const valueEnd = jsonValueEnd(objectText, valueStart);
    const valueSource = objectText.slice(valueStart, valueEnd);
    if (objectText[valueStart] === '"') {
      memberTexts.push([name, decodeJsonString(valueSource)]);
    } else if (exceedsBotApiJsonDepthLimit(valueSource)) {
      return undefined;
    } else {
      memberTexts.push([name, valueSource]);
    }
    position = skipJsonWhitespace(objectText, valueEnd);
    if (objectText[position] === ',') {
      position = skipJsonWhitespace(objectText, position + 1);
    }
  }
  return memberTexts;
}

/** The characters JSON allows between its tokens. */
const JSON_WHITESPACE_CHARACTERS: ReadonlySet<string> = new Set([' ', '\t', '\n', '\r']);
/** The characters that can end a JSON number, `true`, `false` or `null` within an object or array. */
const JSON_SCALAR_TERMINATORS: ReadonlySet<string> = new Set([
  ...JSON_WHITESPACE_CHARACTERS,
  ',',
  '}',
  ']',
]);

/** The position of the first character at or after `position` that is not JSON whitespace. */
function skipJsonWhitespace(jsonText: string, position: number): number {
  let end = position;
  while (JSON_WHITESPACE_CHARACTERS.has(jsonText[end])) {
    end++;
  }
  return end;
}

/** The position just after the JSON value that starts at `start`. */
function jsonValueEnd(jsonText: string, start: number): number {
  const firstCharacter = jsonText[start];
  if (firstCharacter === '"') {
    return jsonStringEnd(jsonText, start);
  }
  if (firstCharacter === '{' || firstCharacter === '[') {
    return jsonContainerEnd(jsonText, start);
  }
  let end = start;
  while (end < jsonText.length && !JSON_SCALAR_TERMINATORS.has(jsonText[end])) {
    end++;
  }
  return end;
}

/** The position just after the JSON string whose opening quote is at `start`. */
function jsonStringEnd(jsonText: string, start: number): number {
  let position = start + 1;
  while (jsonText[position] !== '"') {
    // An escape is a backslash and at least one more character, none of which closes the string.
    position += jsonText[position] === '\\' ? 2 : 1;
  }
  return position + 1;
}

/** The position just after the JSON object or array that opens at `start`. */
function jsonContainerEnd(jsonText: string, start: number): number {
  let depth = 0;
  let position = start;
  do {
    const character = jsonText[position];
    if (character === '"') {
      position = jsonStringEnd(jsonText, position);
      continue;
    }
    if (character === '{' || character === '[') {
      depth++;
    } else if (character === '}' || character === ']') {
      depth--;
    }
    position++;
  } while (depth > 0);
  return position;
}

/**
 * How deeply the official Bot API server lets JSON nest. TDLib's `json_decode`, which reads every
 * JSON-typed parameter, and `do_json_skip`, which skips a JSON body's members, both start a value
 * with this remaining depth, lower it by one inside each array or object, and fail with `Too big
 * object depth` at a value, a scalar included, whose remaining depth is below 0. So a value may sit
 * within at most this many arrays and objects, and an empty array or object one level deeper still
 * passes, as it holds no value.
 */
const BOT_API_JSON_MAX_DEPTH = 100;

/**
 * Whether a value in JSON text sits within more arrays and objects than `BOT_API_JSON_MAX_DEPTH`
 * allows, so that the official Bot API server would refuse it. `jsonText` must be JSON, as
 * `JSON.parse` has checked. A member name counts as deep as its member's value, which follows it.
 * The scan keeps no stack, so no nesting depth can overflow the call stack.
 */
function exceedsBotApiJsonDepthLimit(jsonText: string): boolean {
  let enclosingContainerCount = 0;
  let position = 0;
  while (position < jsonText.length) {
    const character = jsonText[position];
    if (character === '}' || character === ']') {
      enclosingContainerCount--;
    } else if (
      character !== ',' && character !== ':' && !JSON_WHITESPACE_CHARACTERS.has(character)
    ) {
      // Any other character is part of a value or a member name.
      if (enclosingContainerCount > BOT_API_JSON_MAX_DEPTH) {
        return true;
      }
      if (character === '"') {
        position = jsonStringEnd(jsonText, position);
        continue;
      }
      if (character === '{' || character === '[') {
        enclosingContainerCount++;
      }
    }
    position++;
  }
  return false;
}

/**
 * The value of a JSON-typed parameter, such as `reply_markup`, as the official Bot API server's
 * `json_decode` reads it, or `undefined` if that server could not: the text is not JSON, or it
 * nests deeper than `BOT_API_JSON_MAX_DEPTH` allows. Each parameter's reader answers that with its
 * own description, whichever encoding carried the parameter.
 */
export function parseBotApiJsonParameter(text: string): { readonly value: unknown } | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  return exceedsBotApiJsonDepthLimit(text) ? undefined : { value };
}

/** The content of a JSON string's source text, quotes included. */
function decodeJsonString(stringSource: string): string {
  const content: unknown = JSON.parse(stringSource);
  if (typeof content !== 'string') {
    throw new TypeError(`Expected the source text of a JSON string: ${stringSource}`);
  }
  return content;
}

/**
 * A parameter holding a decimal integer. Telegram reads any leading digits and ignores the rest;
 * rejecting other text instead surfaces the bot's mistake in tests.
 */
export function integerParameter<Output>(integerSchema: z.ZodType<Output, number>) {
  return z.string().regex(DECIMAL_INTEGER_PATTERN).transform(Number).pipe(integerSchema);
}

/**
 * An integer parameter that the official Bot API server clamps to a range, as its
 * `get_integer_arg` does.
 */
export function clampedIntegerParameter(min: number, max: number) {
  return integerParameter(z.int().transform((value) => Math.min(Math.max(value, min), max)));
}

/**
 * A parameter holding a decimal number, possibly with a fraction and an exponent, which may be too
 * large to be finite. Telegram reads any leading number and ignores the rest; rejecting other
 * text, such as `NaN`, instead surfaces the bot's mistake in tests.
 */
export function numberParameter() {
  return z.string().regex(DECIMAL_NUMBER_PATTERN).transform(Number);
}

/**
 * A parameter holding a boolean, spelled as Telegram accepts it in any letter case. Telegram reads
 * every other text as false; rejecting it instead surfaces the bot's mistake in tests.
 */
export function booleanParameter() {
  return z.string()
    .transform((text) => text.trim().toLowerCase())
    .pipe(z.enum([...TRUE_BOOLEAN_TEXTS, ...FALSE_BOOLEAN_TEXTS]))
    .transform((text) => (TRUE_BOOLEAN_TEXTS as readonly string[]).includes(text));
}

/** The range of Telegram's 64-bit identifiers. */
const MIN_INT64 = -(2n ** 63n);
const MAX_INT64 = 2n ** 63n - 1n;

/**
 * A 64-bit identifier, such as a message effect's or a custom emoji's, read from its decimal text,
 * where 0 chooses none as it does on Telegram; parses as the identifier's canonical decimal text
 * or `undefined` for none. Telegram reads some such parameters from any leading digits and ignores
 * the rest; rejecting other text instead surfaces the bot's mistake in tests.
 */
export function optionalInt64Identifier() {
  return z.string().regex(DECIMAL_INTEGER_PATTERN).transform(BigInt)
    .refine((identifier) => identifier >= MIN_INT64 && identifier <= MAX_INT64)
    .transform((identifier) => identifier === 0n ? undefined : identifier.toString());
}

/**
 * A parameter holding JSON text, such as an array serialized by a form-encoded request, read as
 * `parseBotApiJsonParameter` reads it. Its schema issue for text that the official Bot API server
 * cannot read as JSON carries `unparsableJsonDescription`, Telegram's description for the
 * parameter, if it has one, as `findTelegramIssueDescription` finds it; without one, the method's
 * own description of parameters that do not fit its schema answers that text.
 */
export function jsonParameter<Output>(
  valueSchema: z.ZodType<Output>,
  { unparsableJsonDescription }: { readonly unparsableJsonDescription?: string } = {},
) {
  return z.string().transform((text, context): unknown => {
    const parsedParameter = parseBotApiJsonParameter(text);
    if (parsedParameter === undefined) {
      context.issues.push({
        code: 'custom',
        message: 'Expected JSON text',
        input: text,
        ...(unparsableJsonDescription === undefined
          ? {}
          : { params: { telegramDescription: unparsableJsonDescription } }),
      });
      return z.NEVER;
    }
    return parsedParameter.value;
  }).pipe(valueSchema);
}

/**
 * Telegram's description of a problem a parameter schema reports, which a parameter such as a
 * `jsonParameter` with `unparsableJsonDescription` gives its issue, or `undefined` for a problem
 * the emulator describes.
 */
export function findTelegramIssueDescription(issue: z.core.$ZodIssue): string | undefined {
  const telegramDescription: unknown = issue.code === 'custom'
    ? issue.params?.telegramDescription
    : undefined;
  return typeof telegramDescription === 'string' ? telegramDescription : undefined;
}

/** The prefix that marks a chat named by its public username rather than its ID. */
export const CHAT_USERNAME_PREFIX = '@';

/**
 * A chat that a JSON object names, as the official Bot API server's `check_chat` reads it: by its
 * ID, or by a public username after `@`. Telegram also reads an ID written as a string; the
 * emulator requires a JSON number, to surface the bot's mistake in tests.
 */
export const chatIdentifierSchema = z.union([
  z.int(),
  z.string().startsWith(CHAT_USERNAME_PREFIX),
]);

export type ChatIdentifier = z.infer<typeof chatIdentifierSchema>;
