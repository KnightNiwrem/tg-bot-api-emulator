/** Wire fields that several control resources share. */
import { z } from 'zod';

import {
  MAX_TELEGRAM_USER_ID,
  MAX_TELEGRAM_USERNAME_LENGTH,
  MIN_TELEGRAM_USER_ID,
  TELEGRAM_USERNAME_PATTERN,
} from '../types/telegram_identity.ts';

/**
 * A URI reference, such as the path `/sessions/1`: text that resolves against a base URL, as WHATWG
 * URL parsing reads it.
 */
export const uriReferenceSchema = z.stringFormat(
  'uri-reference',
  (text) => URL.canParse(text, 'http://base.invalid/'),
);

/** The relative URL of the resource a request created, in its `Location` header. */
export const createdResourceHeadersSchema = z.object({ Location: uriReferenceSchema });

/** The identifier of a session in a control path. */
export const sessionIdParameterSchema = z.string();

export const telegramUserIdSchema = z.int().min(MIN_TELEGRAM_USER_ID).max(MAX_TELEGRAM_USER_ID);

/**
 * A Telegram username, without `@`, of the syntax TDLib's `is_valid_username` admits: from 1 to 32
 * ASCII letters, digits, and underscores, beginning with a letter, without a trailing or doubled
 * underscore.
 */
export const telegramUsernameSchema = z.string()
  .min(1)
  .max(MAX_TELEGRAM_USERNAME_LENGTH)
  .regex(TELEGRAM_USERNAME_PATTERN);
