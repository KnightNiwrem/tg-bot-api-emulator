/** The contracts of a session's virtual accounts, and the profile they show. */
import { z } from 'zod';

import { controlRefusalSchema, controlValidationErrorSchema } from './control_errors.ts';
import { defineControlOperation } from './operation_contract.ts';
import { sessionNotFoundSchema } from './sessions.ts';
import {
  createdResourceHeadersSchema,
  sessionIdParameterSchema,
  telegramUserIdSchema,
  telegramUsernameSchema,
} from './wire_fields.ts';

/**
 * The most characters of an account's first or last name, the server-side limit of TDLib's
 * `UserManager::MAX_NAME_LENGTH`. It keeps an account's own contact within the contact name limit.
 */
const MAX_ACCOUNT_NAME_LENGTH = 64;

/** An E.164 phone number's digits: a country code that never starts with 0, and at most 15 digits. */
const ACCOUNT_PHONE_NUMBER_PATTERN = /^[1-9][0-9]{0,14}$/;

/**
 * An account's first or last name: from 1 to as many characters as Telegram's servers allow,
 * counted by code point, as zod counts a string's length.
 */
const accountNameSchema = z.string().min(1).max(MAX_ACCOUNT_NAME_LENGTH);

/** An account's profile, as bots see the account as a user. */
export const accountProfileSchema = z.strictObject({
  id: telegramUserIdSchema,
  is_bot: z.literal(false),
  first_name: z.string(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  language_code: z.string().optional(),
});

/**
 * An account's profile, privacy settings, and phone number. Each name must also be text that
 * Telegram's cleanup of the account's own contact leaves unchanged, which the server checks and
 * refuses as `name_invalid`.
 */
const createAccountRequestSchema = z.strictObject({
  /** From 1 to 64 characters, as Telegram's servers limit a user's names. */
  first_name: accountNameSchema,
  /** From 1 to 64 characters; omitted for none. */
  last_name: accountNameSchema.optional(),
  /**
   * From 1 to 32 ASCII letters, digits, and underscores, beginning with a letter, without a
   * trailing or doubled underscore, as Telegram's username syntax allows; unique among the
   * session's usernames, compared without case; omitted for none.
   */
  username: telegramUsernameSchema.optional(),
  language_code: z.string().min(1).optional(),
  /**
   * Keeps forwards of the account's messages, and replies to them from other chats, from linking
   * to the account: their origin is a hidden user that shows only its name. Defaults to `false`.
   */
  has_private_forwards: z.boolean().default(false),
  /**
   * The number the account signed up with, which it shares as its own contact: the digits of an
   * E.164 number without its `+`, such as `15550100`, as Telegram's `user.phone` holds them.
   * Omitted for an account that has no contact of its own to share.
   */
  phone_number: z.string().regex(ACCOUNT_PHONE_NUMBER_PATTERN).optional(),
});

const createdAccountSchema = z.strictObject({ account: accountProfileSchema });

export const createAccountContract = defineControlOperation({
  operationId: 'createAccount',
  method: 'POST',
  path: '/sessions/{sessionId}/accounts',
  params: z.strictObject({ sessionId: sessionIdParameterSchema }),
  body: { required: true, schema: createAccountRequestSchema },
  success: {
    status: 201,
    headers: createdResourceHeadersSchema,
    body: { kind: 'json', schema: createdAccountSchema },
  },
  refusals: {
    // A name Telegram's cleanup would change is input the schema accepts but the server refuses.
    400: z.union([controlValidationErrorSchema, controlRefusalSchema(['name_invalid'])]),
    404: sessionNotFoundSchema,
    409: controlRefusalSchema(['username_taken']),
    507: controlRefusalSchema(['identity_limit_reached']),
  },
});
