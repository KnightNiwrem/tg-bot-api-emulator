/**
 * How the Bot API answers a method by the type of chat its `chat_id` names: a user's ID names the
 * bot's private chat with that user, which the bot knows only once the user wrote to it, and any
 * other ID a supergroup. Methods that only supergroups support refuse a private chat the bot knows
 * for their own reason, and one it does not know is not found; methods every chat type supports
 * answer each from that chat type's own state.
 */
import { assertEquals } from '@std/assert';

import { createChatScenario, describeCall } from '../support/chat_type_scenarios.ts';

/** An ID that names no supergroup of the session. */
const UNKNOWN_SUPERGROUP_ID = -1_009_999_999_999;

Deno.test('a method only supergroups support refuses a private chat once the bot knows it', async () => {
  await using scenario = await createChatScenario('private');
  const { api, ada, grace, bot } = scenario;
  const inviteLink = 'https://t.me/+AAAAAAAAAAAAAAAA';
  /** Each method, the parameters that name no chat, and its refusal of a known private chat. */
  const methods: readonly [method: string, parameters: Record<string, unknown>, refusal: string][] =
    [
      ['setChatTitle', { title: 'Team' }, "Bad Request: can't change private chat title"],
      [
        'setChatDescription',
        { description: 'About' },
        "Bad Request: can't change private chat description",
      ],
      [
        'setChatPermissions',
        { permissions: { can_send_messages: true } },
        "Bad Request: can't change private chat permissions",
      ],
      ['leaveChat', {}, "Bad Request: can't leave private chats"],
      [
        'setChatAdministratorCustomTitle',
        { user_id: ada.id, custom_title: 'Chief' },
        'Bad Request: method is available only in groups and supergroups',
      ],
      ['getChatAdministrators', {}, 'Bad Request: there are no administrators in the private chat'],
      ['banChatMember', { user_id: ada.id }, "Bad Request: can't ban members in private chats"],
      [
        'restrictChatMember',
        { user_id: ada.id, permissions: { can_send_messages: false } },
        'Bad Request: method is available only in supergroups',
      ],
      [
        'promoteChatMember',
        { user_id: ada.id },
        'Bad Request: method is available only in supergroup and channel chats',
      ],
      [
        'unbanChatMember',
        { user_id: ada.id },
        'Bad Request: method is available only in supergroup and channel chats',
      ],
      ['exportChatInviteLink', {}, "Bad Request: can't invite members to a private chat"],
      ['createChatInviteLink', {}, "Bad Request: can't invite members to a private chat"],
      [
        'editChatInviteLink',
        { invite_link: inviteLink },
        "Bad Request: can't invite members to a private chat",
      ],
      [
        'revokeChatInviteLink',
        { invite_link: inviteLink },
        "Bad Request: can't invite members to a private chat",
      ],
      [
        'approveChatJoinRequest',
        { user_id: ada.id },
        "Bad Request: the chat can't have join requests",
      ],
      [
        'declineChatJoinRequest',
        { user_id: ada.id },
        "Bad Request: the chat can't have join requests",
      ],
    ];

  const outcomes = [];
  for (const [method, parameters] of methods) {
    outcomes.push([
      method,
      await describeCall(api, bot, method, { ...parameters, chat_id: ada.id }),
      await describeCall(api, bot, method, { ...parameters, chat_id: grace.id }),
      await describeCall(api, bot, method, { ...parameters, chat_id: UNKNOWN_SUPERGROUP_ID }),
    ]);
  }

  assertEquals(
    outcomes,
    methods.map(([method, , refusal]) => [
      method,
      [400, refusal],
      [400, 'Bad Request: chat not found'],
      [400, 'Bad Request: chat not found'],
    ]),
    'Expected a known private chat to be refused for each method, and an unknown chat not found',
  );
});

Deno.test('a method every chat type supports answers a private chat only once the bot knows it', async () => {
  await using scenario = await createChatScenario('private');
  const { api, ada, grace, bot } = scenario;
  const describeForChat = async (chatId: number) => [
    await describeCall(api, bot, 'getChatMember', { chat_id: chatId, user_id: chatId }),
    await describeCall(api, bot, 'getChatMemberCount', { chat_id: chatId }),
    await describeCall(api, bot, 'sendChatAction', { chat_id: chatId, action: 'typing' }),
  ];
  const [knownChat, unknownChat] = [await describeForChat(ada.id), await describeForChat(grace.id)];
  const [chatStatus, chat] = await describeCall(api, bot, 'getChat', { chat_id: ada.id });

  assertEquals(
    [
      knownChat,
      unknownChat,
      [chatStatus, (chat as { type?: string }).type],
      await describeCall(api, bot, 'getChat', { chat_id: grace.id }),
    ],
    [
      [
        [200, { user: ada, status: 'member' }],
        [200, 2],
        [200, true],
      ],
      [
        [400, 'Bad Request: chat not found'],
        [400, 'Bad Request: chat not found'],
        [400, 'Bad Request: chat not found'],
      ],
      [200, 'private'],
      [400, 'Bad Request: chat not found'],
    ],
    'Expected the known private chat to be answered, and the unknown one not found',
  );
});

Deno.test('a feature one chat type lacks is refused by the type of chat the chat_id names', async () => {
  await using privateScenario = await createChatScenario('private');
  await using supergroupScenario = await createChatScenario('supergroup');

  assertEquals(
    [
      // Reactions are not supported in private chats, whether or not the bot knows the chat.
      await describeCall(privateScenario.api, privateScenario.bot, 'setMessageReaction', {
        chat_id: privateScenario.ada.id,
        message_id: privateScenario.botMessageId,
      }),
      await describeCall(privateScenario.api, privateScenario.bot, 'setMessageReaction', {
        chat_id: privateScenario.grace.id,
        message_id: privateScenario.botMessageId,
      }),
      // A message draft is shown only in a private chat.
      await describeCall(supergroupScenario.api, supergroupScenario.bot, 'sendMessageDraft', {
        chat_id: supergroupScenario.chatId,
        draft_id: 1,
        text: 'Thinking',
      }),
      await describeCall(privateScenario.api, privateScenario.bot, 'sendMessageDraft', {
        chat_id: privateScenario.ada.id,
        draft_id: 1,
        text: 'Thinking',
      }),
    ],
    [
      [400, 'Bad Request: reactions in private chats are not supported'],
      [400, 'Bad Request: reactions in private chats are not supported'],
      [400, 'Bad Request: TEXTDRAFT_PEER_INVALID'],
      [200, true],
    ],
    'Expected each feature to be refused only in the chat type that lacks it',
  );
});
