/**
 * The control contracts keep their own copies of facts they share with the emulator's domain, so
 * that the TypeScript client can use them without depending on the emulator's source. These tests
 * check each copy against the domain's value.
 */
import { assertEquals } from '@std/assert';
import { BOT_ACTIVITY_KINDS as CONTRACT_BOT_ACTIVITY_KINDS } from '../src/api/contracts/bot_activity.ts';
import { QUEUEABLE_SERVER_ERROR_CODES as CONTRACT_QUEUEABLE_SERVER_ERROR_CODES } from '../src/api/contracts/queued_bot_api_answers.ts';
import { PLAIN_MESSAGE_ENTITY_TYPES } from '../src/api/contracts/message_entities.ts';
import {
  MAX_POLL_OPEN_PERIOD_SECONDS as CONTRACT_MAX_POLL_OPEN_PERIOD_SECONDS,
  MAX_POLL_OPTION_COUNT as CONTRACT_MAX_POLL_OPTION_COUNT,
  MAX_QUIZ_EXPLANATION_LENGTH as CONTRACT_MAX_QUIZ_EXPLANATION_LENGTH,
  MIN_POLL_OPEN_PERIOD_SECONDS as CONTRACT_MIN_POLL_OPEN_PERIOD_SECONDS,
} from '../src/api/contracts/polls.ts';
import { MAX_INLINE_QUERY_LENGTH as CONTRACT_MAX_INLINE_QUERY_LENGTH } from '../src/api/contracts/inline_queries.ts';
import { uploadProfileSchema } from '../src/api/contracts/sessions.ts';
import {
  CHAT_PERMISSIONS as CONTRACT_CHAT_PERMISSIONS,
  getSupergroupAdministratorsContract,
  setSupergroupCustomTitleContract,
  SUPERGROUP_ADMINISTRATOR_RIGHTS as CONTRACT_SUPERGROUP_ADMINISTRATOR_RIGHTS,
} from '../src/api/contracts/supergroup_administration.ts';
import { expireChatInviteLinkContract } from '../src/api/contracts/supergroups.ts';
import { WEBHOOK_SCHEDULINGS as CONTRACT_WEBHOOK_SCHEDULINGS } from '../src/api/contracts/webhook_attempts.ts';
import {
  MAX_HORIZONTAL_ACCURACY_METERS as CONTRACT_MAX_HORIZONTAL_ACCURACY_METERS,
  supergroupChatIdSchema,
  telegramUserIdSchema,
} from '../src/api/contracts/wire_fields.ts';
import { BOT_ACTIVITY_KINDS } from '../src/types/bot_activity_kind.ts';
import { QUEUEABLE_SERVER_ERROR_CODES } from '../src/types/bot_server_error.ts';
import { WEBHOOK_SCHEDULINGS } from '../src/types/bot_webhook.ts';
import { createInviteLinkHash, isInviteLinkHash } from '../src/types/chat_invite_link.ts';
import {
  MAX_CUSTOM_TITLE_LENGTH,
  SUPERGROUP_ADMINISTRATOR_RIGHTS,
} from '../src/types/chat_membership.ts';
import { CHAT_PERMISSIONS } from '../src/types/chat_permissions.ts';
import {
  MAX_SUPERGROUP_OR_CHANNEL_ID,
  MAX_TELEGRAM_USER_ID,
  MIN_SUPERGROUP_OR_CHANNEL_ID,
  MIN_TELEGRAM_USER_ID,
} from '../src/types/telegram_identity.ts';
import {
  MAX_POLL_OPEN_PERIOD_SECONDS,
  MAX_POLL_OPTION_COUNT,
  MAX_QUIZ_EXPLANATION_LENGTH,
  MIN_POLL_OPEN_PERIOD_SECONDS,
} from '../src/types/poll.ts';
import { MAX_HORIZONTAL_ACCURACY_METERS } from '../src/types/geo_location.ts';
import { MAX_INLINE_QUERY_LENGTH } from '../src/types/inline_query.ts';
import { UPLOAD_PROFILES } from '../src/types/upload_profile.ts';
import type { PlainTextEntityType } from '../src/types/virtual_message.ts';

Deno.test('The contracts name exactly the bot activity kinds the emulator records', () => {
  assertEquals(
    CONTRACT_BOT_ACTIVITY_KINDS,
    BOT_ACTIVITY_KINDS,
    'Expected the same kinds, in order',
  );
});

Deno.test('The contracts take exactly the upload profiles the emulator has', () => {
  assertEquals(
    uploadProfileSchema.options,
    [...UPLOAD_PROFILES],
    'Expected the same profiles, in order',
  );
});

Deno.test('The contracts take exactly the server error codes the emulator can queue', () => {
  assertEquals(
    [...CONTRACT_QUEUEABLE_SERVER_ERROR_CODES],
    [...QUEUEABLE_SERVER_ERROR_CODES],
    'Expected the same codes, in order',
  );
});

Deno.test('The contracts name exactly the webhook schedulings the emulator has', () => {
  assertEquals(
    [...CONTRACT_WEBHOOK_SCHEDULINGS],
    [...WEBHOOK_SCHEDULINGS],
    'Expected the same schedulings, in order',
  );
});

Deno.test('The contracts take exactly the user IDs the emulator assigns', () => {
  const accepted = [MIN_TELEGRAM_USER_ID, MAX_TELEGRAM_USER_ID].map((id) =>
    telegramUserIdSchema.safeParse(id).success
  );
  const refused = [MIN_TELEGRAM_USER_ID - 1, MAX_TELEGRAM_USER_ID + 1].map((id) =>
    telegramUserIdSchema.safeParse(id).success
  );

  assertEquals(accepted, [true, true], 'Expected the bounds of the range accepted');
  assertEquals(refused, [false, false], 'Expected the IDs just outside the range refused');
});

Deno.test('The contracts take exactly the supergroup chat IDs the emulator assigns', () => {
  const accepted = [MIN_SUPERGROUP_OR_CHANNEL_ID, MAX_SUPERGROUP_OR_CHANNEL_ID].map((id) =>
    supergroupChatIdSchema.safeParse(id).success
  );
  const refused = [MIN_SUPERGROUP_OR_CHANNEL_ID - 1, MAX_SUPERGROUP_OR_CHANNEL_ID + 1].map((id) =>
    supergroupChatIdSchema.safeParse(id).success
  );

  assertEquals(accepted, [true, true], 'Expected the bounds of the range accepted');
  assertEquals(refused, [false, false], 'Expected the IDs just outside the range refused');
});

Deno.test('The contracts take exactly the invite link hashes the emulator recognizes', () => {
  const inviteLinkHashSchema = expireChatInviteLinkContract.params.shape.inviteLinkHash;
  const texts = [
    ...Array.from({ length: 100 }, () => createInviteLinkHash()),
    'ABCDEFGHIJKLMNOP',
    'abcdefghij-_0189',
    'ABCDEFGHIJKLMNO',
    'ABCDEFGHIJKLMNOPQ',
    'ABCDEFGHIJKLMNO+',
    'ABCDEFGHIJKLMNO/',
    'ABCDEFGHIJKLMNO\u00e9',
    '',
  ];

  assertEquals(
    texts.map((text) => inviteLinkHashSchema.safeParse(text).success),
    texts.map(isInviteLinkHash),
    'Expected the contract and the domain to agree on every text',
  );
});

Deno.test('The contracts name exactly the administrator rights and chat permissions the emulator has', () => {
  assertEquals(
    [...CONTRACT_SUPERGROUP_ADMINISTRATOR_RIGHTS],
    [...SUPERGROUP_ADMINISTRATOR_RIGHTS],
    'Expected the same rights, in order',
  );
  assertEquals(
    [...CONTRACT_CHAT_PERMISSIONS],
    [...CHAT_PERMISSIONS],
    'Expected the same permissions, in order',
  );
});

Deno.test('The contracts show custom titles of at most the length the emulator allows', () => {
  const administrators = getSupergroupAdministratorsContract.success.body.schema;
  const showsOwnerTitled = (customTitle: string) =>
    administrators.safeParse({
      administrators: [{ user_id: 1, status: 'owner', custom_title: customTitle }],
    }).success;

  assertEquals(
    [
      showsOwnerTitled('😀'.repeat(MAX_CUSTOM_TITLE_LENGTH)),
      showsOwnerTitled('😀'.repeat(MAX_CUSTOM_TITLE_LENGTH + 1)),
    ],
    [true, false],
    'Expected the limit counted by code point',
  );
  assertEquals(
    setSupergroupCustomTitleContract.body.schema.safeParse({ custom_title: '' }).success,
    true,
    'Expected an empty title, which removes it, accepted',
  );
});

Deno.test('The contracts limit polls as the emulator does', () => {
  assertEquals(
    [
      CONTRACT_MAX_POLL_OPTION_COUNT,
      CONTRACT_MIN_POLL_OPEN_PERIOD_SECONDS,
      CONTRACT_MAX_POLL_OPEN_PERIOD_SECONDS,
      CONTRACT_MAX_QUIZ_EXPLANATION_LENGTH,
    ],
    [
      MAX_POLL_OPTION_COUNT,
      MIN_POLL_OPEN_PERIOD_SECONDS,
      MAX_POLL_OPEN_PERIOD_SECONDS,
      MAX_QUIZ_EXPLANATION_LENGTH,
    ],
    'Expected the same option count, open periods and explanation length',
  );
});

/** Whether two unions have exactly the same members. */
type HaveSameMembers<Left, Right> = [Exclude<Left, Right>, Exclude<Right, Left>] extends
  [never, never] ? true : false;

Deno.test('The contracts name exactly the plain entity types the emulator has', () => {
  // The emulator keeps these types as a type alone, so the check is that this type-checks.
  const namesTheSameTypes: HaveSameMembers<
    typeof PLAIN_MESSAGE_ENTITY_TYPES[number],
    PlainTextEntityType
  > = true;
  assertEquals(namesTheSameTypes, true);
  assertEquals(
    new Set(PLAIN_MESSAGE_ENTITY_TYPES).size,
    PLAIN_MESSAGE_ENTITY_TYPES.length,
    'Expected each type named once',
  );
});

Deno.test('The contracts limit inline queries and location accuracy as the emulator does', () => {
  assertEquals(
    [CONTRACT_MAX_INLINE_QUERY_LENGTH, CONTRACT_MAX_HORIZONTAL_ACCURACY_METERS],
    [MAX_INLINE_QUERY_LENGTH, MAX_HORIZONTAL_ACCURACY_METERS],
    'Expected the same query length and accuracy limits',
  );
});
