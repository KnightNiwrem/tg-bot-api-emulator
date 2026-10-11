/**
 * The client reads the action receipt every successful control action answers with from the
 * response's headers, refuses a success whose receipt is missing or malformed, and starts waits
 * after a receipt of the log's own session only.
 */
import { assertEquals, assertRejects, assertThrows } from '@std/assert';

import {
  ACTION_RECEIPT_ACTIVITY_POSITION_HEADER,
  ACTION_RECEIPT_SESSION_ID_HEADER,
} from '../../src/api/contracts/action_receipts.ts';
import { createBotContract } from '../../src/api/contracts/bots.ts';
import { addSupergroupMemberContract } from '../../src/api/contracts/supergroups.ts';
import {
  type BotActivityPageReader,
  type BotActivityPageRequest,
  createBotActivityLog,
} from './bot_activity_log.ts';
import {
  callEmptyAction,
  callJsonAction,
  type ControlOperationTransport,
} from './control_operation_caller.ts';
import { EmulationClientError } from './emulation_client_error.ts';
import {
  TEST_ACTION_RECEIPT,
  TEST_ACTION_RECEIPT_HEADERS,
} from './test_support/action_receipt_headers.ts';
import { sendMessageCall } from './test_support/bot_activity_waits.ts';
import type { ActionReceipt } from './types.ts';

const CREATED_BOT = {
  token: '1000000001:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  bot: {
    id: 1_000_000_001,
    is_bot: true,
    first_name: 'Shop',
    username: 'shop_bot',
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
    has_topics_enabled: false,
    allows_users_to_create_topics: false,
    can_manage_bots: false,
    supports_join_request_queries: false,
  },
};

const SUPERGROUP_MEMBER_PARAMS = {
  sessionId: TEST_ACTION_RECEIPT.sessionId,
  accountId: 1,
  chatId: -1_000_000_000_001,
  userId: 2,
};

/** A transport that answers every request with `response`, made anew for each request. */
function transportAnswering(response: () => Response): ControlOperationTransport {
  return {
    serverRoot: new URL('http://emulator.example/'),
    fetch: () => Promise.resolve(response()),
  };
}

function createBotWith(headers: HeadersInit) {
  return callJsonAction(
    transportAnswering(() => Response.json(CREATED_BOT, { status: 201, headers })),
    createBotContract,
    {
      params: { sessionId: TEST_ACTION_RECEIPT.sessionId },
      body: { first_name: 'Shop', username: 'shop_bot' },
    },
  );
}

Deno.test('An action answers with its result and the receipt its headers carry', async () => {
  const creation = await createBotWith(TEST_ACTION_RECEIPT_HEADERS);
  const addition = await callEmptyAction(
    transportAnswering(() =>
      new Response(null, { status: 204, headers: TEST_ACTION_RECEIPT_HEADERS })
    ),
    addSupergroupMemberContract,
    { params: SUPERGROUP_MEMBER_PARAMS },
  );

  assertEquals(
    [creation, addition],
    [{ result: CREATED_BOT, receipt: TEST_ACTION_RECEIPT }, TEST_ACTION_RECEIPT],
    'Expected a JSON action to resolve to its result and receipt, and a 204 action to its receipt',
  );
});

Deno.test('A success without a well-formed receipt is refused', async () => {
  const position = String(TEST_ACTION_RECEIPT.activityPosition);
  const cases: readonly { headers: Record<string, string>; problem: string }[] = [
    { headers: {}, problem: 'no Action-Receipt-Session-Id or Action-Receipt-Activity-Position' },
    {
      headers: { [ACTION_RECEIPT_ACTIVITY_POSITION_HEADER]: position },
      problem: 'no Action-Receipt-Session-Id header',
    },
    {
      headers: { [ACTION_RECEIPT_SESSION_ID_HEADER]: TEST_ACTION_RECEIPT.sessionId },
      problem: 'no Action-Receipt-Activity-Position header',
    },
    ...['', '-1', '+1', '01', '1.5', '1e3', 'seven'].map((positionText) => ({
      headers: {
        [ACTION_RECEIPT_SESSION_ID_HEADER]: TEST_ACTION_RECEIPT.sessionId,
        [ACTION_RECEIPT_ACTIVITY_POSITION_HEADER]: positionText,
      },
      problem: 'which is no decimal position',
    })),
    {
      headers: {
        [ACTION_RECEIPT_SESSION_ID_HEADER]: TEST_ACTION_RECEIPT.sessionId,
        [ACTION_RECEIPT_ACTIVITY_POSITION_HEADER]: '9007199254740993',
      },
      problem: 'a malformed action receipt',
    },
    {
      headers: {
        [ACTION_RECEIPT_SESSION_ID_HEADER]: 'session',
        [ACTION_RECEIPT_ACTIVITY_POSITION_HEADER]: position,
      },
      problem: 'a malformed action receipt',
    },
  ];

  for (const { headers, problem } of cases) {
    await assertRejects(
      () => createBotWith(headers),
      EmulationClientError,
      problem,
      `Expected ${JSON.stringify(headers)} refused`,
    );
  }
  await assertRejects(
    () =>
      callEmptyAction(
        transportAnswering(() => new Response(null, { status: 204 })),
        addSupergroupMemberContract,
        { params: SUPERGROUP_MEMBER_PARAMS },
      ),
    EmulationClientError,
    'succeeded with no Action-Receipt-Session-Id or Action-Receipt-Activity-Position header',
  );
});

/** A page reader of `sessionId`'s log that answers every read with one entry and records it. */
function createRecordingPageReader(
  sessionId: string,
): BotActivityPageReader & { readonly requests: readonly BotActivityPageRequest[] } {
  const requests: BotActivityPageRequest[] = [];
  return {
    sessionId,
    requests,
    readPage(request) {
      requests.push(request);
      const entry = sendMessageCall(request.after + 1, 'Hello');
      return Promise.resolve({
        entries: request.limit === 0 ? [] : [entry],
        headPosition: entry.position,
      });
    },
  };
}

Deno.test('A wait, a check and a cursor start after a receipt of the log session', async () => {
  const pageReader = createRecordingPageReader(TEST_ACTION_RECEIPT.sessionId);
  const activity = createBotActivityLog(pageReader, undefined, {});
  const after = TEST_ACTION_RECEIPT;

  const found = await activity.waitFor({}, { after });
  const cursor = activity.cursor({ after });
  const next = await cursor.next({});
  await assertRejects(
    () => activity.assertNone({}, { after, before: found.position + 1 }),
    Error,
    `after position ${after.activityPosition}`,
  );

  assertEquals(
    [found.position, cursor.position, next.position],
    [after.activityPosition + 1, after.activityPosition + 1, after.activityPosition + 1],
    'Expected each search to start after the receipt',
  );
  assertEquals(
    pageReader.requests.map((request) => request.after),
    [after.activityPosition, after.activityPosition, after.activityPosition],
    'Expected each read to start after the receipt',
  );
});

Deno.test('A receipt of another session starts no wait, check or cursor', async () => {
  const pageReader = createRecordingPageReader(TEST_ACTION_RECEIPT.sessionId);
  const activity = createBotActivityLog(pageReader, undefined, {});
  const otherSessionReceipt: ActionReceipt = {
    sessionId: '0b9e6c1a-4a8f-4e2b-9d43-7c1f0a6b2e15',
    activityPosition: TEST_ACTION_RECEIPT.activityPosition,
  };
  const refusal =
    `The action receipt is of session ${otherSessionReceipt.sessionId}, not of this bot activity ` +
    `log's session ${TEST_ACTION_RECEIPT.sessionId}`;

  await assertRejects(
    () => activity.waitFor({}, { after: otherSessionReceipt }),
    TypeError,
    refusal,
  );
  await assertRejects(
    () => activity.assertNone({}, { after: otherSessionReceipt, before: 1 }),
    TypeError,
    refusal,
  );
  assertThrows(() => activity.cursor({ after: otherSessionReceipt }), TypeError, refusal);
  assertEquals(pageReader.requests, [], 'Expected no read for a receipt of another session');
});
