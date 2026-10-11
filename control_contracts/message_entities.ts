/**
 * Wire facts of the entities that mark spans of message text, captions, and poll texts, as the
 * Bot API shows them: each kind of entity with exactly the fields it has.
 */
import { z } from 'zod';

import { accountProfileSchema } from './accounts.ts';
import { messageSenderBotSchema } from './bots.ts';

/** The kinds of entity that mark a span without saying more about it. */
export const PLAIN_MESSAGE_ENTITY_TYPES = [
  'mention',
  'hashtag',
  'cashtag',
  'bot_command',
  'url',
  'email',
  'bank_card_number',
  'bold',
  'italic',
  'underline',
  'strikethrough',
  'spoiler',
  'code',
  'blockquote',
  'expandable_blockquote',
] as const;

/** Where an entity's span is, in UTF-16 code units, as the Bot API counts them. */
const messageEntitySpanShape = {
  /** The offset to the start of the entity. */
  offset: z.int().min(0),
  /** The length of the entity. */
  length: z.int().min(1),
};

/** A custom emoji, the only entity Telegram keeps in poll questions and options. */
export const customEmojiEntitySchema = z.strictObject({
  type: z.literal('custom_emoji'),
  ...messageEntitySpanShape,
  /** The custom emoji's identifier, the decimal text of a 64-bit integer. */
  custom_emoji_id: z.string().regex(/^-?\d+$/),
});

/**
 * A marked span of message text. Formatting that overlaps other entities is split so that
 * entities nest properly, as on Telegram.
 */
export const messageEntitySchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.enum(PLAIN_MESSAGE_ENTITY_TYPES), ...messageEntitySpanShape }),
  z.strictObject({
    type: z.literal('pre'),
    ...messageEntitySpanShape,
    /** The programming language of the code, when one is given. */
    language: z.string().min(1).optional(),
  }),
  z.strictObject({
    type: z.literal('text_link'),
    ...messageEntitySpanShape,
    /** The link as Telegram normalized it. */
    url: z.string(),
  }),
  z.strictObject({
    type: z.literal('text_mention'),
    ...messageEntitySpanShape,
    /** The mentioned user. */
    user: z.union([accountProfileSchema, messageSenderBotSchema]),
  }),
  customEmojiEntitySchema,
  z.strictObject({
    type: z.literal('date_time'),
    ...messageEntitySpanShape,
    /** The shown moment, as a Unix time. */
    unix_time: z.int().min(1),
    /**
     * How clients show it, as the official Bot API server reports it: `r` for relative time,
     * otherwise `w` for the day of the week, `d` or `D` for a short or long date, then `t` or `T`
     * for a short or long time; empty when the bot chose no format.
     */
    date_time_format: z.string().regex(/^(r|w?[dD]?[tT]?)$/),
  }),
]);
