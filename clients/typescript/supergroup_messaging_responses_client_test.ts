/**
 * The client refuses responses of an account's supergroup reads that break what their contracts
 * promise, and reads those that keep it: reactions with the emoji the Bot API lists, bot IDs in
 * Telegram's user ID range, and supergroup messages of a supergroup.
 */
import { assertEquals, assertRejects } from '@std/assert';

import { getSupergroupMessageHistoryContract } from '../../src/api/contracts/account_messages.ts';
import { getSupergroupBotCommandsContract } from '../../src/api/contracts/conversation_reads.ts';
import { getSupergroupMessageReactionsContract } from '../../src/api/contracts/message_reactions.ts';
import { callJsonOperation, type ControlOperationTransport } from './control_operation_caller.ts';
import { EmulationClientError } from './emulation_client_error.ts';

function transportAnswering(body: unknown): ControlOperationTransport {
  return {
    serverRoot: new URL('http://emulator.example/'),
    fetch: () => Promise.resolve(Response.json(body)),
  };
}

const supergroupParams = { sessionId: 'session', accountId: 1, chatId: -1_000_000_000_001 };

const textMessage = {
  message_id: 1,
  from: { id: 1, is_bot: false, first_name: 'Ada' },
  chat: { id: -1_000_000_000_001, title: 'Team', type: 'supergroup' },
  date: 1,
  text: 'Hello',
} as const;

const readReactions = (reactions: readonly unknown[]) =>
  callJsonOperation(
    transportAnswering({ message: textMessage, reactions }),
    getSupergroupMessageReactionsContract,
    { params: { ...supergroupParams, messageId: 1 } },
  );

async function assertRefused(read: () => Promise<unknown>, label: string): Promise<void> {
  await assertRejects(read, EmulationClientError, undefined, `Expected ${label} refused`);
}

Deno.test('A supergroup read that breaks its contract is refused', async () => {
  await assertRefused(
    () => readReactions([{ user_id: 1, reaction: [{ type: 'emoji', emoji: '❤️' }] }]),
    'a reaction emoji the Bot API does not list',
  );
  await assertRefused(
    () => readReactions([{ user_id: 1, reaction: [] }]),
    'a member without a reaction',
  );
  await assertRefused(
    () =>
      callJsonOperation(
        transportAnswering({ bot_commands: [{ bot_id: 0, commands: [] }] }),
        getSupergroupBotCommandsContract,
        { params: supergroupParams },
      ),
    'a bot ID of 0',
  );
  await assertRefused(
    () =>
      callJsonOperation(
        transportAnswering({
          messages: [{ ...textMessage, chat: { id: 1, type: 'private', first_name: 'Ada' } }],
        }),
        getSupergroupMessageHistoryContract,
        { params: supergroupParams },
      ),
    'a message of a private chat',
  );
});

Deno.test('A supergroup read that keeps its contract is read as sent', async () => {
  const reaction = { user_id: 1, reaction: [{ type: 'emoji' as const, emoji: '❤' as const }] };

  const reactions = await readReactions([reaction]);

  assertEquals(
    reactions,
    { message: textMessage, reactions: [reaction] },
    'Expected the reactions read as they were sent',
  );
});
