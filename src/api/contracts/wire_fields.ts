/** Wire fields that several control resources share. */
import { z } from 'zod';

/** Telegram's user IDs, which accounts and bots share: from 1 to 2^40 - 1. */
const MIN_TELEGRAM_USER_ID = 1;
const MAX_TELEGRAM_USER_ID = 0xff_ffff_ffff;

/** The most characters of a username. */
const MAX_TELEGRAM_USERNAME_LENGTH = 32;

/**
 * An ASCII letter, then ASCII letters and digits, each of which may follow a single underscore, so
 * that an underscore is never last nor doubled.
 */
const TELEGRAM_USERNAME_PATTERN = /^[A-Za-z](?:_?[A-Za-z0-9])*$/;

/**
 * A URI reference, such as the path `/sessions/1`: text that resolves against a base URL, as WHATWG
 * URL parsing reads it.
 */
export const uriReferenceSchema = z.stringFormat(
  'uri-reference',
  (text) => URL.canParse(text, 'http://base.invalid/'),
);

/**
 * Bytes written as base64 text, as `Uint8Array.fromBase64` reads it: padding may be left out and
 * ASCII whitespace is ignored. The server refuses other text as an `invalid_value` issue, since
 * JSON Schema's `contentEncoding` annotates rather than checks.
 */
export const base64TextSchema = z.string().meta({ contentEncoding: 'base64' });

/** The relative URL of the resource a request created, in its `Location` header. */
export const createdResourceHeadersSchema = z.object({ Location: uriReferenceSchema });

/** The identifier of a session in a control path. */
export const sessionIdParameterSchema = z.string();

export const telegramUserIdSchema = z.int().min(MIN_TELEGRAM_USER_ID).max(MAX_TELEGRAM_USER_ID);

/**
 * The Bot API chat IDs of supergroups, which carry Telegram's `-100` prefix: from
 * -1997852516352 to -1000000000001.
 */
const MIN_SUPERGROUP_CHAT_ID = -1_997_852_516_352;
const MAX_SUPERGROUP_CHAT_ID = -1_000_000_000_001;

/** The Bot API chat ID of a supergroup. */
export const supergroupChatIdSchema = z.int().min(MIN_SUPERGROUP_CHAT_ID).max(
  MAX_SUPERGROUP_CHAT_ID,
);

/**
 * A Telegram username, without `@`, of the syntax TDLib's `is_valid_username` admits: from 1 to 32
 * ASCII letters, digits, and underscores, beginning with a letter, without a trailing or doubled
 * underscore.
 *
 * Telegram's further rules for choosing a new username, such as its minimum of 5 characters, the
 * `bot` ending of a bot's username, and reserved prefixes, are not checked: older usernames, such
 * as `@gif`'s, break them and still name real chats.
 */
export const telegramUsernameSchema = z.string()
  .min(1)
  .max(MAX_TELEGRAM_USERNAME_LENGTH)
  .regex(TELEGRAM_USERNAME_PATTERN);

/** An account's private chat with a bot, by the bot's ID. */
export const privateMessageTargetSchema = z.strictObject({
  type: z.literal('private'),
  botId: telegramUserIdSchema,
});

/**
 * The chat an account writes in: its private chat with a bot, or a supergroup it is a member of.
 */
export const messageTargetSchema = z.discriminatedUnion('type', [
  privateMessageTargetSchema,
  z.strictObject({ type: z.literal('supergroup'), chatId: supergroupChatIdSchema }),
]);

/** The widest radius of uncertainty of a location, in meters, that TDLib's `Location` keeps. */
export const MAX_HORIZONTAL_ACCURACY_METERS = 1500;

/** A latitude, from -90 to 90 degrees, and a longitude, from -180 to 180. */
const coordinatesShape = {
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
};

/** A point on Earth an account shares, with the accuracy its client reports. */
export const accountLocationInputSchema = z.strictObject({
  ...coordinatesShape,
  /**
   * The radius of uncertainty, from 0 to 1500 meters, which Telegram rounds up to whole meters;
   * omitted or 0 when unknown.
   */
  horizontal_accuracy: z.number().min(0).max(MAX_HORIZONTAL_ACCURACY_METERS).optional(),
});

/** A point on Earth an account shared, as the Bot API shows it. */
export const sharedLocationSchema = z.strictObject({
  ...coordinatesShape,
  /** The radius of uncertainty in whole meters; omitted when unknown. */
  horizontal_accuracy: z.int().min(1).max(MAX_HORIZONTAL_ACCURACY_METERS).optional(),
});

/**
 * The annotation that names the Telegram type of an object a control response carries unchanged,
 * such as an `Update`, whose fields are Telegram's rather than the control API's. The OpenAPI
 * document gives its description of the emulator's subset of that type the same annotation.
 */
export const TELEGRAM_TYPE_ANNOTATION = 'x-telegram-type';

/**
 * A Telegram object that a control response carries as the Bot API shows it, of the Telegram type
 * `telegramTypeName`. The contract checks only the fields of `shape` and lets every other field
 * through, as Telegram, not the control API, decides them.
 */
export function telegramObjectSchema<const Shape extends z.core.$ZodLooseShape>(
  telegramTypeName: string,
  shape: Shape,
) {
  return z.looseObject(shape).meta({ [TELEGRAM_TYPE_ANNOTATION]: telegramTypeName });
}
