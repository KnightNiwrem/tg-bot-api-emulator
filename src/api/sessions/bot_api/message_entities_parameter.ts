import { z } from 'zod';

import type {
  DateTimeFormat,
  DateTimePartPrecision,
  PlainTextEntityType,
  TextEntity,
} from '../../../types/virtual_message.ts';
import { BOT_API_ERRORS } from './errors/error_catalogue.ts';
import { jsonParameter } from './request_parameters.ts';

export type MessageEntitiesParameterReading =
  | { readonly read: true; readonly entities: readonly TextEntity[] }
  | { readonly read: false; readonly description: string };

/**
 * Why the official Bot API server's `get_text_entity` cannot parse an entity: it has no type, a
 * type the server does not know, or a `date_time_format` the server cannot read.
 */
export type MessageEntityError = {
  readonly reason: 'type_missing' | 'type_unsupported' | 'date_time_format_invalid';
};

/**
 * Entities as `readMessageEntities` reads them: the entities, Telegram's error for the first it
 * cannot parse, or an entity that Telegram would read leniently.
 */
export type MessageEntitiesReading =
  | { readonly read: true; readonly entities: readonly TextEntity[] }
  | {
    readonly read: false;
    readonly reason: 'entity_unparsable';
    readonly entityError: MessageEntityError;
  }
  | { readonly read: false; readonly reason: 'entity_malformed' };

/**
 * Entity types that Telegram detects in text by itself; it ignores them when a sender specifies
 * them, so entities copied from a received message can be sent back as they are.
 */
const DETECTED_ENTITY_TYPES = [
  'mention',
  'hashtag',
  'cashtag',
  'bot_command',
  'url',
  'email',
  'phone_number',
  'bank_card_number',
] as const;

const SPECIFIABLE_PLAIN_ENTITY_TYPES = [
  'bold',
  'italic',
  'underline',
  'strikethrough',
  'spoiler',
  'code',
  'blockquote',
  'expandable_blockquote',
] as const satisfies readonly PlainTextEntityType[];

const entitySpanShape = { offset: z.int(), length: z.int() };

const detectedEntitySchema = z.strictObject({
  type: z.enum(DETECTED_ENTITY_TYPES),
  ...entitySpanShape,
});
const plainEntitySchema = z.strictObject({
  type: z.enum(SPECIFIABLE_PLAIN_ENTITY_TYPES),
  ...entitySpanShape,
});
const preEntitySchema = z.strictObject({
  type: z.literal('pre'),
  ...entitySpanShape,
  language: z.string().optional(),
});
const textLinkEntitySchema = z.strictObject({
  type: z.literal('text_link'),
  ...entitySpanShape,
  url: z.string(),
});
// Telegram reads only the mentioned user's ID, so a full user object from a received message is
// accepted as it is.
const textMentionEntitySchema = z.strictObject({
  type: z.literal('text_mention'),
  ...entitySpanShape,
  user: z.looseObject({ id: z.int() }),
});
const customEmojiEntitySchema = z.strictObject({
  type: z.literal('custom_emoji'),
  ...entitySpanShape,
  custom_emoji_id: z.string(),
});
// Telegram reads the Unix time as a 32-bit integer.
const dateTimeEntitySchema = z.strictObject({
  type: z.literal('date_time'),
  ...entitySpanShape,
  unix_time: z.int().min(-(2 ** 31)).max(2 ** 31 - 1),
  date_time_format: z.string().optional(),
});

/** An `entities` parameter: a JSON array whose elements `readMessageEntitiesParameter` reads. */
export function messageEntitiesParameter() {
  return jsonParameter(z.array(z.unknown()));
}

/**
 * Reads the elements of an `entities` parameter as `readMessageEntities` does, failing with
 * Telegram's description for an entity it cannot parse.
 *
 * `invalidParametersDescription` answers entities that Telegram would read leniently, such as
 * numbers written as strings, which are rejected instead to surface the bot's mistake in tests.
 */
export function readMessageEntitiesParameter(
  entityValues: readonly unknown[],
  invalidParametersDescription: string,
): MessageEntitiesParameterReading {
  const reading = readMessageEntities(entityValues);
  if (reading.read) {
    return reading;
  }
  return {
    read: false,
    description: reading.reason === 'entity_unparsable'
      ? BOT_API_ERRORS.formattedTextInvalid.description({
        reason: 'entity_unparsable',
        entityError: reading.entityError,
      })
      : invalidParametersDescription,
  };
}

/**
 * Reads the elements of an `entities` parameter as the official Bot API server's
 * `get_text_entity` does, stopping at the first entity it cannot parse or that Telegram would
 * read leniently.
 */
export function readMessageEntities(entityValues: readonly unknown[]): MessageEntitiesReading {
  const entities: TextEntity[] = [];
  for (const entityValue of entityValues) {
    const reading = readMessageEntity(entityValue);
    switch (reading.kind) {
      case 'entity':
        entities.push(reading.entity);
        break;
      case 'ignored':
        break;
      case 'unparsable':
        return { read: false, reason: 'entity_unparsable', entityError: reading.entityError };
      case 'malformed':
        return { read: false, reason: 'entity_malformed' };
      default: {
        const unhandledReading: never = reading;
        throw new Error(`Unhandled entity reading: ${JSON.stringify(unhandledReading)}`);
      }
    }
  }
  return { read: true, entities };
}

type MessageEntityReading =
  | { readonly kind: 'entity'; readonly entity: TextEntity }
  | { readonly kind: 'ignored' }
  /** Telegram cannot parse the entity, for the reason `entityError` gives. */
  | { readonly kind: 'unparsable'; readonly entityError: MessageEntityError }
  | { readonly kind: 'malformed' };

/** Reads one Bot API `MessageEntity` object, as the Bot API server's `get_text_entity` does. */
function readMessageEntity(value: unknown): MessageEntityReading {
  const typeReading = z.looseObject({ type: z.string() }).safeParse(value);
  if (!typeReading.success) {
    return { kind: 'malformed' };
  }
  const { type } = typeReading.data;
  if (type.length === 0) {
    return { kind: 'unparsable', entityError: { reason: 'type_missing' } };
  }

  if (isOneOf(type, DETECTED_ENTITY_TYPES)) {
    return detectedEntitySchema.safeParse(value).success
      ? { kind: 'ignored' }
      : { kind: 'malformed' };
  }
  if (isOneOf(type, SPECIFIABLE_PLAIN_ENTITY_TYPES)) {
    const entity = plainEntitySchema.safeParse(value);
    return entity.success ? { kind: 'entity', entity: entity.data } : { kind: 'malformed' };
  }
  switch (type) {
    case 'pre': {
      const entity = preEntitySchema.safeParse(value);
      if (!entity.success) {
        return { kind: 'malformed' };
      }
      const { offset, length, language } = entity.data;
      // Telegram reads an empty language as none.
      return {
        kind: 'entity',
        entity: language === undefined || language.length === 0
          ? { type, offset, length }
          : { type, offset, length, language },
      };
    }
    case 'text_link': {
      const entity = textLinkEntitySchema.safeParse(value);
      return entity.success ? { kind: 'entity', entity: entity.data } : { kind: 'malformed' };
    }
    case 'text_mention': {
      const entity = textMentionEntitySchema.safeParse(value);
      if (!entity.success) {
        return { kind: 'malformed' };
      }
      const { offset, length, user } = entity.data;
      return { kind: 'entity', entity: { type, offset, length, userId: user.id } };
    }
    case 'custom_emoji': {
      const entity = customEmojiEntitySchema.safeParse(value);
      if (!entity.success) {
        return { kind: 'malformed' };
      }
      const { offset, length, custom_emoji_id } = entity.data;
      return {
        kind: 'entity',
        entity: { type, offset, length, customEmojiId: custom_emoji_id },
      };
    }
    case 'date_time': {
      const entity = dateTimeEntitySchema.safeParse(value);
      if (!entity.success) {
        return { kind: 'malformed' };
      }
      const { offset, length, unix_time: unixTime, date_time_format } = entity.data;
      const formatReading = readDateTimeFormat(date_time_format ?? '');
      if (!formatReading.valid) {
        return { kind: 'unparsable', entityError: { reason: 'date_time_format_invalid' } };
      }
      const { format } = formatReading;
      return {
        kind: 'entity',
        entity: { type, offset, length, unixTime, ...(format === undefined ? {} : { format }) },
      };
    }
    default:
      return { kind: 'unparsable', entityError: { reason: 'type_unsupported' } };
  }
}

/**
 * Reads a `date_time_format` as the official Bot API server's `get_date_time_formatting_type`
 * does: empty for no format, exactly `r` or `R` for relative time, or letters choosing the parts
 * to show. `t` or `T` shows a short or long time, `d` or `D` a short or long date, and `w` or `W`
 * the day of the week; the last letter for a part decides its precision.
 */
export function readDateTimeFormat(
  format: string,
): { readonly valid: true; readonly format?: DateTimeFormat } | { readonly valid: false } {
  if (format.length === 0) {
    return { valid: true };
  }
  if (format === 'r' || format === 'R') {
    return { valid: true, format: { kind: 'relative' } };
  }
  let timePrecision: DateTimePartPrecision | undefined;
  let datePrecision: DateTimePartPrecision | undefined;
  let showsDayOfWeek = false;
  for (const letter of format) {
    switch (letter) {
      case 't':
        timePrecision = 'short';
        break;
      case 'T':
        timePrecision = 'long';
        break;
      case 'd':
        datePrecision = 'short';
        break;
      case 'D':
        datePrecision = 'long';
        break;
      case 'w':
      case 'W':
        showsDayOfWeek = true;
        break;
      default:
        return { valid: false };
    }
  }
  return {
    valid: true,
    format: {
      kind: 'absolute',
      ...(timePrecision === undefined ? {} : { timePrecision }),
      ...(datePrecision === undefined ? {} : { datePrecision }),
      showsDayOfWeek,
    },
  };
}

function isOneOf<Value extends string>(value: string, values: readonly Value[]): value is Value {
  return (values as readonly string[]).includes(value);
}
