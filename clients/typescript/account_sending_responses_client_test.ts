/**
 * The client refuses a message an account sends that the emulator answers with as a message of
 * another chat's type, as it refuses a response that breaks its contract, and reads one of the
 * chat's type as sent.
 */
import { assertEquals, assertRejects } from '@std/assert';

import { EmulationClientError } from './emulation_client_error.ts';
import { TelegramEmulationClient } from './telegram_emulation_client.ts';
import {
  TEST_ACTION_RECEIPT,
  TEST_ACTION_RECEIPT_HEADERS,
} from './test_support/action_receipt_headers.ts';
import type { PrivateMessageTarget, VirtualAccountClient } from './types.ts';

const SESSION_ID = TEST_ACTION_RECEIPT.sessionId;
const ACCOUNT = { first_name: 'Ada', id: 1, is_bot: false } as const;
const TO_BOT: PrivateMessageTarget = { type: 'private', botId: 2 };

const privateMessage = {
  message_id: 1,
  from: ACCOUNT,
  chat: { id: 1, type: 'private', first_name: 'Ada' },
  date: 1,
  text: 'Hello',
} as const;

const supergroupMessage = {
  ...privateMessage,
  chat: { id: -1_000_000_000_001, title: 'Team', type: 'supergroup' },
} as const;

/**
 * An account client whose emulator answers its session's and account's creation, and answers a
 * sent message with `sentMessage`.
 */
async function createAccountAnsweringWith(sentMessage: unknown): Promise<VirtualAccountClient> {
  const fetch = (input: RequestInfo | URL): Promise<Response> => {
    const { pathname } = new URL(input instanceof Request ? input.url : input);
    if (pathname === '/sessions') {
      return Promise.resolve(Response.json({
        id: SESSION_ID,
        botApiRoot: 'http://emulator.example/bot-api/',
        uploadProfile: 'cloud',
      }, {
        status: 201,
        headers: { ...TEST_ACTION_RECEIPT_HEADERS, Location: `/sessions/${SESSION_ID}` },
      }));
    }
    if (pathname === `/sessions/${SESSION_ID}/accounts`) {
      return Promise.resolve(Response.json({ account: ACCOUNT }, {
        status: 201,
        headers: { ...TEST_ACTION_RECEIPT_HEADERS, Location: `/sessions/${SESSION_ID}/accounts/1` },
      }));
    }
    return Promise.resolve(
      Response.json({ message: sentMessage }, {
        status: 201,
        headers: TEST_ACTION_RECEIPT_HEADERS,
      }),
    );
  };
  const client = new TelegramEmulationClient('http://emulator.example/', { fetch });
  const { result: session } = await client.createSession();
  const { result: { account } } = await session.createAccount({ first_name: 'Ada' });
  return account;
}

Deno.test('A sent message of another chat type than its chat is refused', async () => {
  const account = await createAccountAnsweringWith(supergroupMessage);

  await assertRejects(
    () => account.sendMessage({ to: TO_BOT, text: 'Hello' }),
    EmulationClientError,
    'returned a message of a supergroup chat for a private chat',
  );
});

Deno.test('A sent message of its chat type is read as sent', async () => {
  const account = await createAccountAnsweringWith(privateMessage);

  const { result } = await account.sendMessage({ to: TO_BOT, text: 'Hello' });

  assertEquals(result, privateMessage, 'Expected the message read as it was sent');
});
