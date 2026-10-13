/**
 * The client refuses a message an account sends that the emulator answers with as a message of
 * another chat's type, as it refuses a response that breaks its contract, with the response's
 * status and raw body, and reads one of the chat's type as sent.
 */
import { assertEquals, assertInstanceOf, assertRejects, assertStringIncludes } from '@std/assert';

import { EmulationClientError, EmulationControlError } from './emulation_client_error.ts';
import { TelegramEmulationClient } from './telegram_emulation_client.ts';
import {
  TEST_ACTION_RECEIPT,
  TEST_ACTION_RECEIPT_HEADERS,
} from './test_support/action_receipt_headers.ts';
import type {
  ActionOutcome,
  ControlErrorBody,
  MessageTarget,
  PrivateMessageTarget,
  SupergroupMessageTarget,
  VirtualAccountClient,
} from './types.ts';

const SERVER_ROOT = 'http://emulator.example/';
const SESSION_ID = TEST_ACTION_RECEIPT.sessionId;
const ACCOUNT = { first_name: 'Ada', id: 1, is_bot: false } as const;
const ACCOUNT_URL = `${SERVER_ROOT}sessions/${SESSION_ID}/accounts/${ACCOUNT.id}`;
const ACTION_RESPONSE_STATUS = 201;

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

const TO_BOT: PrivateMessageTarget = { type: 'private', botId: 2 };
const TO_TEAM: SupergroupMessageTarget = { type: 'supergroup', chatId: supergroupMessage.chat.id };

type SentMessage = typeof privateMessage | typeof supergroupMessage;

/**
 * An account action that sends a message to a chat: how the account takes it, the URL it calls,
 * the response body that answers it with a message, and the result that body reads as.
 */
interface MessageSendingAction {
  readonly name: string;
  readonly url: string;
  readonly send: (
    account: VirtualAccountClient,
    to: MessageTarget,
  ) => Promise<ActionOutcome<unknown>>;
  readonly answerWith: (message: SentMessage) => unknown;
  readonly resultOf: (message: SentMessage) => unknown;
}

const messageSendingActions: readonly MessageSendingAction[] = [
  {
    name: 'sendMessage',
    url: `${ACCOUNT_URL}/messages`,
    send: (account, to) => account.sendMessage({ to, text: 'Hello' }),
    answerWith: (message) => ({ message }),
    resultOf: (message) => message,
  },
  {
    name: 'forwardMessage',
    url: `${ACCOUNT_URL}/messages`,
    send: (account, to) => account.forwardMessage({ to, from: TO_BOT, message_id: 1 }),
    answerWith: (message) => ({ message }),
    resultOf: (message) => message,
  },
  {
    name: 'sendMediaGroup',
    url: `${ACCOUNT_URL}/media-groups`,
    send: (account, to) =>
      account.sendMediaGroup({
        to,
        media: [{ photo: new Uint8Array([1]) }, { photo: new Uint8Array([2]) }],
      }),
    answerWith: (message) => ({ messages: albumOf(message) }),
    resultOf: albumOf,
  },
  {
    name: 'pressReplyKeyboardButton',
    url: `${ACCOUNT_URL}/reply-keyboard-presses`,
    send: (account, chat) => account.pressReplyKeyboardButton({ chat, text: 'Hello' }),
    answerWith: (message) => ({ message }),
    resultOf: (message) => message,
  },
];

/** The messages of a two-photo album whose first message is `message`. */
function albumOf(message: SentMessage): readonly unknown[] {
  return [message, { ...message, message_id: message.message_id + 1 }];
}

/** A chat an account sends to, the message of its type, and a message of the other type. */
const chatKinds = [
  { to: TO_BOT, messageOfChat: privateMessage, messageOfOtherChat: supergroupMessage },
  { to: TO_TEAM, messageOfChat: supergroupMessage, messageOfOtherChat: privateMessage },
] as const;

/**
 * An account client whose emulator answers its session's and account's creation, and answers any
 * other request, such as a sent message, with `actionResponseText` and an action receipt, as
 * `actionResponseStatus`.
 */
async function createAccountAnsweringWith(
  actionResponseText: string,
  actionResponseStatus = ACTION_RESPONSE_STATUS,
): Promise<VirtualAccountClient> {
  const fetch = (input: RequestInfo | URL): Promise<Response> => {
    const { pathname } = new URL(input instanceof Request ? input.url : input);
    if (pathname === '/sessions') {
      return Promise.resolve(Response.json({
        id: SESSION_ID,
        botApiRoot: `${SERVER_ROOT}bot-api/`,
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
      new Response(actionResponseText, {
        status: actionResponseStatus,
        headers: { ...TEST_ACTION_RECEIPT_HEADERS, 'Content-Type': 'application/json' },
      }),
    );
  };
  const client = new TelegramEmulationClient(SERVER_ROOT, { fetch });
  const { result: session } = await client.createSession();
  const { result: { account } } = await session.createAccount({ first_name: 'Ada' });
  return account;
}

/** Response text as no client would write it again from the parsed body, to tell the two apart. */
function writeResponseText(body: unknown): string {
  return `${JSON.stringify(body, null, 2)}\n`;
}

for (const action of messageSendingActions) {
  for (const { to, messageOfChat, messageOfOtherChat } of chatKinds) {
    Deno.test(`${action.name} refuses a message of a ${messageOfOtherChat.chat.type} chat for a ${to.type} chat, keeping the response`, async () => {
      const responseText = writeResponseText(action.answerWith(messageOfOtherChat));
      const account = await createAccountAnsweringWith(responseText);

      const error = await assertRejects(
        () => action.send(account, to),
        EmulationClientError,
        'returned a response that does not match its contract',
      );

      assertInstanceOf(error, EmulationClientError);
      assertStringIncludes(error.message, `the ${to.type} chat`);
      assertEquals(
        {
          method: error.method,
          url: error.url,
          status: error.status,
          responseBody: error.responseBody,
        },
        {
          method: 'POST',
          url: action.url,
          status: ACTION_RESPONSE_STATUS,
          responseBody: responseText,
        },
        'Expected the error to keep the request, the status, and the raw response body',
      );
    });

    Deno.test(`${action.name} reads a message of a ${to.type} chat as sent`, async () => {
      const account = await createAccountAnsweringWith(
        writeResponseText(action.answerWith(messageOfChat)),
      );

      const outcome = await action.send(account, to);

      assertEquals(
        outcome,
        { result: action.resultOf(messageOfChat), receipt: TEST_ACTION_RECEIPT },
        'Expected the message read as it was sent, with the action receipt',
      );
    });
  }

  Deno.test(`${action.name} sends a target that is no chat for the emulator to refuse`, async () => {
    const refusal: ControlErrorBody = {
      reason: 'invalid_request',
      issues: [{ source: 'body', path: ['to'], code: 'invalid_type', message: 'Expected a chat' }],
    };
    const account = await createAccountAnsweringWith(writeResponseText(refusal), 400);
    // An untyped caller can give any value, which the client sends as it is.
    const noChat = null as unknown as MessageTarget;

    const error = await assertRejects(() => action.send(account, noChat), EmulationControlError);

    assertEquals(error.body, refusal, "Expected the emulator's refusal");
  });
}

Deno.test('A sent message that breaks the contract is refused with the response', async () => {
  const responseText = writeResponseText({ message: { message_id: 1 } });
  const account = await createAccountAnsweringWith(responseText);

  const error = await assertRejects(
    () => account.sendMessage({ to: TO_BOT, text: 'Hello' }),
    EmulationClientError,
    'returned a response that does not match its contract',
  );

  assertInstanceOf(error, EmulationClientError);
  assertEquals(
    { status: error.status, responseBody: error.responseBody },
    { status: ACTION_RESPONSE_STATUS, responseBody: responseText },
    'Expected the error to keep the status and the raw response body',
  );
});
