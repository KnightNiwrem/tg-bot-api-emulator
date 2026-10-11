/**
 * The client keeps its own copies of facts it shares with the emulator, so that it does not depend
 * on the emulator's source. These tests check each copy against the emulator's.
 */
import { assertEquals } from '@std/assert';
import { BOT_ACTIVITY_KINDS as SERVER_BOT_ACTIVITY_KINDS } from '../../src/types/bot_activity_kind.ts';
import { listLegacyBotApiMethodNames } from '../../src/types/bot_api_method_name.ts';
import { MAX_CUSTOM_TITLE_LENGTH as SERVER_MAX_CUSTOM_TITLE_LENGTH } from '../../src/types/chat_membership.ts';
import * as serverIdentityRanges from '../../src/types/telegram_identity.ts';
import { LEGACY_BOT_API_METHOD_NAMES } from './bot_api_method_name.ts';
import {
  BOT_ACTIVITY_KINDS,
  MAX_CUSTOM_TITLE_LENGTH,
  MAX_SUPERGROUP_OR_CHANNEL_ID,
  MAX_TELEGRAM_USER_ID,
  MIN_SUPERGROUP_OR_CHANNEL_ID,
  MIN_TELEGRAM_USER_ID,
} from './constants.ts';

Deno.test('The client knows the kinds of bot activity entry the emulator records', () => {
  assertEquals(BOT_ACTIVITY_KINDS, SERVER_BOT_ACTIVITY_KINDS, 'Expected the same kinds, in order');
});

Deno.test('The client knows the legacy Bot API method names the emulator reads', () => {
  assertEquals(
    LEGACY_BOT_API_METHOD_NAMES,
    listLegacyBotApiMethodNames(),
    'Expected the same legacy names, with the same current names',
  );
});

Deno.test('The client checks the limits the emulator enforces', () => {
  assertEquals(
    {
      MAX_CUSTOM_TITLE_LENGTH,
      MIN_TELEGRAM_USER_ID,
      MAX_TELEGRAM_USER_ID,
      MIN_SUPERGROUP_OR_CHANNEL_ID,
      MAX_SUPERGROUP_OR_CHANNEL_ID,
    },
    {
      MAX_CUSTOM_TITLE_LENGTH: SERVER_MAX_CUSTOM_TITLE_LENGTH,
      MIN_TELEGRAM_USER_ID: serverIdentityRanges.MIN_TELEGRAM_USER_ID,
      MAX_TELEGRAM_USER_ID: serverIdentityRanges.MAX_TELEGRAM_USER_ID,
      MIN_SUPERGROUP_OR_CHANNEL_ID: serverIdentityRanges.MIN_SUPERGROUP_OR_CHANNEL_ID,
      MAX_SUPERGROUP_OR_CHANNEL_ID: serverIdentityRanges.MAX_SUPERGROUP_OR_CHANNEL_ID,
    },
    'Expected the same limits',
  );
});
