import { z } from 'zod';

import { createGeoLocation, MAX_HORIZONTAL_ACCURACY_METERS } from '../../../types/geo_location.ts';
import {
  MAX_SUPERGROUP_OR_CHANNEL_ID,
  MAX_TELEGRAM_USER_ID,
  MIN_SUPERGROUP_OR_CHANNEL_ID,
  MIN_TELEGRAM_USER_ID,
} from '../../../types/telegram_identity.ts';

export const telegramUserIdSchema = z.number().int()
  .min(MIN_TELEGRAM_USER_ID)
  .max(MAX_TELEGRAM_USER_ID);
export const supergroupChatIdSchema = z.number().int()
  .min(MIN_SUPERGROUP_OR_CHANNEL_ID)
  .max(MAX_SUPERGROUP_OR_CHANNEL_ID);

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
