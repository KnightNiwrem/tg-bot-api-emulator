/**
 * The control contracts keep their own copies of facts they share with the emulator's domain, so
 * that the TypeScript client can use them without depending on the emulator's source. These tests
 * check each copy against the domain's value.
 */
import { assertEquals } from '@std/assert';
import { BOT_ACTIVITY_KINDS as CONTRACT_BOT_ACTIVITY_KINDS } from '../control_contracts/bot_activity.ts';
import { uploadProfileSchema } from '../control_contracts/sessions.ts';
import { expireChatInviteLinkContract } from '../control_contracts/supergroups.ts';
import { supergroupChatIdSchema, telegramUserIdSchema } from '../control_contracts/wire_fields.ts';
import { BOT_ACTIVITY_KINDS } from '../src/types/bot_activity_kind.ts';
import { createInviteLinkHash, isInviteLinkHash } from '../src/types/chat_invite_link.ts';
import {
  MAX_SUPERGROUP_OR_CHANNEL_ID,
  MAX_TELEGRAM_USER_ID,
  MIN_SUPERGROUP_OR_CHANNEL_ID,
  MIN_TELEGRAM_USER_ID,
} from '../src/types/telegram_identity.ts';
import { UPLOAD_PROFILES } from '../src/types/upload_profile.ts';

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
