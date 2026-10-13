/**
 * The client refuses a checkout attempt that an action answers with in another status than the
 * action leaves it in, as it refuses a response that breaks its contract, with the response's
 * status and raw body, and reads an attempt in the promised status as it is.
 */
import { assertEquals, assertInstanceOf, assertRejects } from '@std/assert';

import { EmulationClientError } from './emulation_client_error.ts';
import { TelegramEmulationClient } from './telegram_emulation_client.ts';
import {
  TEST_ACTION_RECEIPT,
  TEST_ACTION_RECEIPT_HEADERS,
} from './test_support/action_receipt_headers.ts';
import type {
  ActionOutcome,
  CheckoutAttempt,
  PrivateMessageTarget,
  VirtualAccountClient,
} from './types.ts';

const SERVER_ROOT = 'http://emulator.example/';
const SESSION_ID = TEST_ACTION_RECEIPT.sessionId;
const ACCOUNT = { first_name: 'Ada', id: 1, is_bot: false } as const;
const ATTEMPTS_URL =
  `${SERVER_ROOT}sessions/${SESSION_ID}/accounts/${ACCOUNT.id}/checkout-attempts`;
const SHOP: PrivateMessageTarget = { type: 'private', botId: 2 };

const attempt = {
  id: '1',
  chat: SHOP,
  message_id: 3,
  invoice: {
    title: 'Premium access',
    description: 'Unlocks every premium chapter',
    start_parameter: '',
    currency: 'XTR',
    total_amount: 50,
  },
  status: 'pending',
} as const;

const completedAttempt = {
  ...attempt,
  status: 'completed',
  payment: {
    receipt_message_id: 4,
    telegram_payment_charge_id: 'emulator_telegram_charge_1',
    provider_payment_charge_id: 'emulator_provider_charge_1',
  },
} as const;

/**
 * An action on a checkout attempt: how the account takes it, its URL and response status, and the
 * attempt it promises to leave.
 */
interface CheckoutAction {
  readonly name: string;
  readonly url: string;
  readonly responseStatus: number;
  readonly leaves: CheckoutAttempt;
  readonly act: (account: VirtualAccountClient) => Promise<ActionOutcome<unknown>>;
}

const checkoutActions: readonly CheckoutAction[] = [
  {
    name: 'submitCheckout',
    url: ATTEMPTS_URL,
    responseStatus: 201,
    leaves: attempt,
    act: (account) => account.submitCheckout({ chat: SHOP, message_id: attempt.message_id }),
  },
  {
    name: 'completeCheckoutAttempt',
    url: `${ATTEMPTS_URL}/1/completion`,
    responseStatus: 200,
    leaves: completedAttempt,
    act: (account) => account.completeCheckoutAttempt(attempt.id),
  },
  {
    name: 'abandonCheckoutAttempt',
    url: `${ATTEMPTS_URL}/1/abandonment`,
    responseStatus: 200,
    leaves: { ...attempt, status: 'abandoned' },
    act: (account) => account.abandonCheckoutAttempt(attempt.id),
  },
  {
    name: 'expireCheckoutAttempt',
    url: `${ATTEMPTS_URL}/1/expiry`,
    responseStatus: 200,
    leaves: { ...attempt, status: 'expired' },
    act: (account) => account.expireCheckoutAttempt(attempt.id),
  },
];

/**
 * An account client whose emulator answers its session's and account's creation, and answers any
 * other request with `actionResponseText` and an action receipt, as `actionResponseStatus`.
 */
async function createAccountAnsweringWith(
  actionResponseText: string,
  actionResponseStatus: number,
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
        headers: {
          ...TEST_ACTION_RECEIPT_HEADERS,
          'Content-Type': 'application/json',
          Location: `/sessions/${SESSION_ID}/accounts/1/checkout-attempts/1`,
        },
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

for (const action of checkoutActions) {
  Deno.test(`${action.name} refuses an attempt in another status, keeping the response`, async () => {
    const otherStatus = action.leaves.status === 'pending' ? 'approved' : 'pending';
    const responseText = writeResponseText({
      checkout_attempt: { ...attempt, status: otherStatus },
    });
    const account = await createAccountAnsweringWith(responseText, action.responseStatus);

    const error = await assertRejects(
      () => action.act(account),
      EmulationClientError,
      'returned a response that does not match its contract',
    );

    assertInstanceOf(error, EmulationClientError);
    assertEquals(
      { method: error.method, url: error.url, status: error.status, body: error.responseBody },
      { method: 'POST', url: action.url, status: action.responseStatus, body: responseText },
      'Expected the error to keep the request, the status, and the raw response body',
    );
  });

  Deno.test(`${action.name} reads an attempt that is ${action.leaves.status}`, async () => {
    const answered = action.leaves;
    const account = await createAccountAnsweringWith(
      writeResponseText({ checkout_attempt: answered }),
      action.responseStatus,
    );

    assertEquals(
      await action.act(account),
      { result: answered, receipt: TEST_ACTION_RECEIPT },
      'Expected the attempt read as it is, with the action receipt',
    );
  });
}

Deno.test("A refused checkout attempt is read with the bot's explanation", async () => {
  const refused = { ...attempt, status: 'refused', error_message: 'Sold out' } as const;
  const account = await createAccountAnsweringWith(
    writeResponseText({ checkout_attempt: refused }),
    200,
  );

  assertEquals(await account.getCheckoutAttempt(attempt.id), refused);
});

Deno.test("A refused checkout attempt without the bot's explanation is refused", async () => {
  const account = await createAccountAnsweringWith(
    writeResponseText({ checkout_attempt: { ...attempt, status: 'refused' } }),
    200,
  );

  await assertRejects(
    () => account.getCheckoutAttempt(attempt.id),
    EmulationClientError,
    'does not match its contract',
  );
});

Deno.test('A completed checkout attempt is read with its payment, and refused without it', async () => {
  const account = await createAccountAnsweringWith(
    writeResponseText({ checkout_attempt: completedAttempt }),
    200,
  );
  assertEquals(await account.getCheckoutAttempt(attempt.id), completedAttempt);

  const { payment: _payment, ...withoutPayment } = completedAttempt;
  const accountWithoutPayment = await createAccountAnsweringWith(
    writeResponseText({ checkout_attempt: withoutPayment }),
    200,
  );
  await assertRejects(
    () => accountWithoutPayment.getCheckoutAttempt(attempt.id),
    EmulationClientError,
    'does not match its contract',
  );
});
