/**
 * The client refuses responses of an account's private chat reads that break what their contracts
 * promise, and reads those that keep it: bot IDs in Telegram's user ID range, poll IDs of at most
 * 19 digits, non-empty command texts and placeholders, and messages with exactly the fields their
 * kind has.
 */
import { assertEquals, assertRejects } from '@std/assert';

import { getPrivateMessageHistoryContract } from '../../src/api/contracts/account_messages.ts';
import { getPrivateChatActionsContract } from '../../src/api/contracts/chat_actions.ts';
import {
  getPrivateChatBotCommandsContract,
  getPrivateChatMenuButtonContract,
  getPrivateChatReplyInterfaceContract,
} from '../../src/api/contracts/conversation_reads.ts';
import { getAccountPollAnswerContract } from '../../src/api/contracts/poll_answers.ts';
import { MAX_TELEGRAM_USER_ID } from './constants.ts';
import { callJsonOperation, type ControlOperationTransport } from './control_operation_caller.ts';
import { EmulationClientError } from './emulation_client_error.ts';

function transportAnswering(body: unknown): ControlOperationTransport {
  return {
    serverRoot: new URL('http://emulator.example/'),
    fetch: () => Promise.resolve(Response.json(body)),
  };
}

const privateChatParams = { sessionId: 'session', accountId: 1, botId: 2 };

const textMessage = {
  message_id: 1,
  from: { id: 1, is_bot: false, first_name: 'Ada' },
  chat: { id: 1, type: 'private', first_name: 'Ada' },
  date: 1,
  text: 'Hello',
};

async function assertRefused(read: () => Promise<unknown>, label: string): Promise<void> {
  await assertRejects(read, EmulationClientError, undefined, `Expected ${label} refused`);
}

Deno.test('A private chat read that breaks its contract is refused', async () => {
  const readChatActions = (chatActions: readonly unknown[]) =>
    callJsonOperation(
      transportAnswering({ chat_actions: chatActions }),
      getPrivateChatActionsContract,
      { params: privateChatParams },
    );
  const readHistory = (messages: readonly unknown[]) =>
    callJsonOperation(transportAnswering({ messages }), getPrivateMessageHistoryContract, {
      params: privateChatParams,
    });

  await assertRefused(
    () => readChatActions([{ bot_id: MAX_TELEGRAM_USER_ID + 1, action: 'typing' }]),
    'a bot ID beyond the user ID range',
  );
  await assertRefused(
    () => readChatActions([{ bot_id: 2, action: 'cancel' }]),
    'a chat action that shows nothing',
  );
  await assertRefused(
    () =>
      callJsonOperation(
        transportAnswering({
          commands: [{ command: '', description: 'Start', is_ephemeral: false }],
        }),
        getPrivateChatBotCommandsContract,
        { params: privateChatParams },
      ),
    'an empty command',
  );
  await assertRefused(
    () =>
      callJsonOperation(
        transportAnswering({
          menu_button: { type: 'web_app', text: '', web_app: { url: 'https://example.com' } },
        }),
        getPrivateChatMenuButtonContract,
        { params: privateChatParams },
      ),
    'a Web App menu button without text',
  );
  await assertRefused(
    () =>
      callJsonOperation(
        transportAnswering({
          reply_interface: { type: 'force_reply', message_id: 1, input_field_placeholder: '' },
        }),
        getPrivateChatReplyInterfaceContract,
        { params: privateChatParams },
      ),
    'an empty input field placeholder',
  );
  await assertRefused(
    () =>
      callJsonOperation(
        transportAnswering({
          poll_answer: { poll_id: '1'.repeat(20), option_ids: [], option_persistent_ids: [] },
          message: textMessage,
        }),
        getAccountPollAnswerContract,
        { params: { ...privateChatParams, messageId: 1 } },
      ),
    'a poll ID of 20 digits',
  );
  await assertRefused(
    () => readHistory([{ ...textMessage, photo: [] }]),
    'a text message with a photo field',
  );
});

Deno.test('A private chat read that keeps its contract is read as sent', async () => {
  const history = await callJsonOperation(
    transportAnswering({ messages: [textMessage] }),
    getPrivateMessageHistoryContract,
    { params: privateChatParams },
  );
  const chatActions = await callJsonOperation(
    transportAnswering({ chat_actions: [{ bot_id: MAX_TELEGRAM_USER_ID, action: 'typing' }] }),
    getPrivateChatActionsContract,
    { params: privateChatParams },
  );
  const replyInterface = await callJsonOperation(
    transportAnswering({ reply_interface: null }),
    getPrivateChatReplyInterfaceContract,
    { params: privateChatParams },
  );

  assertEquals(
    [history.messages, chatActions.chat_actions, replyInterface.reply_interface],
    [[textMessage], [{ bot_id: MAX_TELEGRAM_USER_ID, action: 'typing' }], null],
    'Expected each response read as it was sent',
  );
});
