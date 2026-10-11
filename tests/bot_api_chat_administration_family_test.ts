import { assertRejects } from '@std/assert';
import { createBotApiCommandSession } from './support/bot_api_command_session.ts';
import { assertEqualsInFieldOrder } from './support/field_order_assertion.ts';
import { createVirtualAccount } from './support/virtual_users.ts';

// The chat administration methods, called through the method catalogue as a bot calls them, for
// what their HTTP tests do not reach: views of a supergroup's restrictions and an unknown bot.

Deno.test('the chat administration methods show restricted members and default permissions', async () => {
  using harness = createBotApiCommandSession('chat-administration-restrictions');
  const { sharedChatAdministration } = harness.session;
  const ownerId = harness.createAccount('Owner');
  const member = createVirtualAccount(harness.session.virtualUsers, { first_name: 'Ada' }).profile;
  const memberId = member.id;
  const bot = harness.createBot('test_bot');
  const chatId = createSupergroup(harness, ownerId);
  for (const addedMemberId of [memberId, bot.id]) {
    sharedChatAdministration.addChatMember({
      actorAccountId: ownerId,
      chatId,
      memberId: addedMemberId,
    });
  }
  const restriction = sharedChatAdministration.restrictChatMemberAsAccount({
    actorAccountId: ownerId,
    chatId,
    memberId,
    permissions: new Set(['can_send_messages', 'can_send_voice_notes']),
    requestedRestrictionEndUnixSeconds: 1_700_003_600,
  });
  if (!restriction.changed) {
    throw new Error(`Expected member ${memberId} to be restricted: ${restriction.reason}`);
  }
  const permissionChange = sharedChatAdministration.changeDefaultPermissions({
    actor: { kind: 'account', accountId: ownerId },
    chatId,
    permissions: new Set(['can_send_messages', 'can_send_polls', 'can_invite_users']),
  });
  if (!permissionChange.changed) {
    throw new Error(`Expected the default permissions to change: ${permissionChange.reason}`);
  }

  const chatMember = await harness.callMethodExpectingResult(bot, 'getChatMember', {
    chat_id: String(chatId),
    user_id: String(memberId),
  });
  const chat = await harness.callMethodExpectingResult(bot, 'getChat', { chat_id: String(chatId) });
  const permissionsOf = (granted: readonly string[]) =>
    Object.fromEntries(
      [
        'can_send_messages',
        'can_send_media_messages',
        'can_send_audios',
        'can_send_documents',
        'can_send_photos',
        'can_send_videos',
        'can_send_video_notes',
        'can_send_voice_notes',
        'can_send_polls',
        'can_send_other_messages',
        'can_add_web_page_previews',
        'can_react_to_messages',
        'can_edit_tag',
        'can_change_info',
        'can_invite_users',
        'can_pin_messages',
        'can_manage_topics',
      ].map((permission) => [permission, granted.includes(permission)]),
    );
  assertEqualsInFieldOrder(
    [
      chatMember,
      typeof chat === 'object' && chat !== null && 'permissions' in chat ? chat.permissions : chat,
    ],
    [
      {
        user: member,
        status: 'restricted',
        until_date: 1_700_003_600,
        ...permissionsOf(['can_send_messages', 'can_send_media_messages', 'can_send_voice_notes']),
        is_member: true,
      },
      permissionsOf(['can_send_messages', 'can_send_polls', 'can_invite_users']),
    ],
    'Expected the restriction and default permissions',
  );
});

Deno.test('the chat information methods refuse to change a supergroup for a bot that does not exist', async () => {
  using harness = createBotApiCommandSession('chat-information-missing-bot');
  const ownerId = harness.createAccount('Owner');
  const bot = harness.createBot('test_bot');
  const chatId = createSupergroup(harness, ownerId);
  // An authenticated bot always exists, so a bot that does not is an internal error, not a reason.
  const missingBot = { ...bot, id: bot.id + 1 };
  const expectedMessage = `Bot ${missingBot.id} could not act in chat ${chatId}: actor_not_found`;

  const changes = [
    ['setChatTitle', { chat_id: String(chatId), title: 'Renamed' }],
    ['setChatDescription', { chat_id: String(chatId), description: 'About' }],
    ['setChatPermissions', { chat_id: String(chatId), permissions: '{}' }],
  ] as const;
  for (const [method, parameters] of changes) {
    await assertRejects(
      () => harness.callMethod(missingBot, method, parameters),
      Error,
      expectedMessage,
      `Expected ${method} to throw ${expectedMessage}`,
    );
  }
});

/** Creates a supergroup that the account owns, and returns its ID. */
function createSupergroup(
  harness: ReturnType<typeof createBotApiCommandSession>,
  ownerId: number,
): number {
  const creation = harness.session.sharedChatAdministration.createSupergroup({
    title: 'Team',
    creatorAccountId: ownerId,
  });
  if (!creation.created) {
    throw new Error(`Expected the supergroup to be created, received ${creation.reason}`);
  }
  return creation.supergroup.id;
}
