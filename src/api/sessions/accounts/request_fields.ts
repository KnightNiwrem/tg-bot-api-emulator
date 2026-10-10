import { z } from 'zod';

import { createGeoLocation, MAX_HORIZONTAL_ACCURACY_METERS } from '../../../types/geo_location.ts';
import type { SpecifiedAccountPoll } from '../../../types/poll.ts';
import {
  isTelegramUsername,
  MAX_SUPERGROUP_OR_CHANNEL_ID,
  MAX_TELEGRAM_USER_ID,
  MIN_SUPERGROUP_OR_CHANNEL_ID,
  MIN_TELEGRAM_USER_ID,
} from '../../../types/telegram_identity.ts';
import { readMessageEntitiesParameter } from '../bot_api/message_entities_parameter.ts';

export const telegramUserIdSchema = z.number().int()
  .min(MIN_TELEGRAM_USER_ID)
  .max(MAX_TELEGRAM_USER_ID);
export const supergroupChatIdSchema = z.number().int()
  .min(MIN_SUPERGROUP_OR_CHANNEL_ID)
  .max(MAX_SUPERGROUP_OR_CHANNEL_ID);

/** A username of Telegram's syntax, such as an account, bot, or public supergroup takes. */
export const telegramUsernameSchema = z.string().refine(isTelegramUsername, {
  message: "Expected a username of Telegram's syntax",
});

/**
 * The chat a message goes to or a button is on: a private chat with a bot, or a supergroup the
 * account is a member of.
 */
export const chatSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('private'), botId: telegramUserIdSchema }),
  z.strictObject({ type: z.literal('supergroup'), chatId: supergroupChatIdSchema }),
]);

/**
 * A point on Earth the account shares, with the radius of uncertainty its client reports, which
 * becomes whole meters as `createGeoLocation` rounds it.
 */
export const accountLocationSchema = z.strictObject({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  horizontal_accuracy: z.number().min(0).max(MAX_HORIZONTAL_ACCURACY_METERS).default(0),
}).transform(({ latitude, longitude, horizontal_accuracy }) =>
  createGeoLocation(latitude, longitude, horizontal_accuracy)
);

/**
 * Formatting an account specifies for its text, caption, or poll, as the Bot API's
 * `MessageEntity` objects, which are read as for bots: entity types Telegram detects by itself are
 * ignored.
 */
export const messageEntitiesSchema = z.array(z.unknown()).transform((entityValues, context) => {
  const reading = readMessageEntitiesParameter(entityValues, 'Invalid message entities');
  if (!reading.read) {
    context.issues.push({ code: 'custom', message: reading.description, input: entityValues });
    return z.NEVER;
  }
  return reading.entities;
}).optional();

/** A poll option's text, with the formatting the account specifies, of which custom emoji stay. */
const accountPollOptionSchema = z.strictObject({
  text: z.string(),
  text_entities: messageEntitiesSchema,
});

/**
 * A poll an account creates, with the settings `sendPoll` takes from bots and their defaults: an
 * anonymous poll, with one answer, and revoting allowed for a regular poll but not for a quiz. A
 * quiz lists its correct options, as option positions in increasing order, and may explain them;
 * a regular poll has neither. Its texts are normalized, and its limits checked, when it is sent.
 */
export const accountPollSchema = z.strictObject({
  question: z.string(),
  question_entities: messageEntitiesSchema,
  options: z.array(accountPollOptionSchema),
  is_anonymous: z.boolean().default(true),
  type: z.enum(['regular', 'quiz']).default('regular'),
  allows_multiple_answers: z.boolean().default(false),
  allows_revoting: z.boolean().optional(),
  correct_option_ids: z.array(z.int().nonnegative()).optional(),
  explanation: z.string().optional(),
  explanation_entities: messageEntitiesSchema,
}).transform((poll, context): SpecifiedAccountPoll => {
  const { type, correct_option_ids, explanation, explanation_entities } = poll;
  if (
    type === 'regular' &&
    (correct_option_ids !== undefined || explanation !== undefined ||
      explanation_entities !== undefined)
  ) {
    context.addIssue({ code: 'custom', message: 'Only a quiz has correct options or explanation' });
    return z.NEVER;
  }
  if (explanation === undefined && explanation_entities !== undefined) {
    context.addIssue({ code: 'custom', message: 'Explanation entities need an explanation' });
    return z.NEVER;
  }
  return {
    question: { text: poll.question, entities: poll.question_entities },
    options: poll.options.map(({ text, text_entities }) => ({ text, entities: text_entities })),
    isAnonymous: poll.is_anonymous,
    allowsMultipleAnswers: poll.allows_multiple_answers,
    allowsRevoting: poll.allows_revoting ?? type === 'regular',
    type: type === 'regular' ? { kind: 'regular' } : {
      kind: 'quiz',
      correctOptionPositions: correct_option_ids ?? [],
      explanation: { text: explanation ?? '', entities: explanation_entities },
    },
  };
});
