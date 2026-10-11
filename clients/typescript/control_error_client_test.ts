import { assertEquals } from '@std/assert';
import { createTestInProcessEmulator } from '../../tests/support/emulation_api.ts';
import {
  type ControlErrorBody,
  type ControlRefusalReason,
  type ControlRequestIssue,
  type ControlValidationErrorBody,
  EmulationClientError,
  EmulationControlError,
  TelegramEmulationClient,
} from './mod.ts';

const PUBLIC_ORIGIN = 'http://emulator.example:9000';

Deno.test('A refusal rejects with an EmulationControlError naming its reason', async () => {
  await using emulator = createTestInProcessEmulator();
  const { client } = emulator;
  const { result: session } = await client.createSession();
  await session.createBot({ first_name: 'Shop', username: 'shop_bot' });

  const refusal = await rejectionOf(
    session.createBot({ first_name: 'Other shop', username: 'Shop_Bot' }),
  );

  if (!(refusal instanceof EmulationControlError) || !(refusal instanceof EmulationClientError)) {
    throw new Error(`Expected a control error, which is a client error, received ${refusal}`);
  }
  assertEquals(
    {
      name: refusal.name,
      method: refusal.method,
      status: refusal.status,
      reason: refusal.reason,
      body: refusal.body,
      responseBody: refusal.responseBody,
    },
    {
      name: 'EmulationControlError',
      method: 'POST',
      status: 409,
      reason: 'username_taken',
      body: { reason: 'username_taken' },
      responseBody: '{"reason":"username_taken"}',
    },
    'Expected the refusal with its status, reason, and raw body',
  );
  if (!refusal.message.endsWith('returned HTTP 409; expected 201: username_taken')) {
    throw new Error(`Expected the message to name the reason, received ${refusal.message}`);
  }
});

Deno.test('Input the emulator rejects lists each issue on the control error', async () => {
  await using emulator = createTestInProcessEmulator();
  const { client } = emulator;
  const { result: session } = await client.createSession();
  const { result: { bot } } = await session.createBot({ first_name: 'Shop', username: 'shop_bot' });

  const refusal = await rejectionOf(
    session.queueServerErrorResponses({ bot_id: bot.id, method: 'sendTelepathy', error_code: 500 }),
  );

  if (!(refusal instanceof EmulationControlError) || refusal.body.issues === undefined) {
    throw new Error(`Expected a control error with issues, received ${refusal}`);
  }
  // Checking for issues narrows the body to a validation failure, whose reason is fixed.
  const validationFailure: ControlValidationErrorBody = refusal.body;
  assertEquals(
    {
      status: refusal.status,
      reason: validationFailure.reason,
      issues: validationFailure.issues.map(({ source, path, code }) => ({ source, path, code })),
    },
    {
      status: 400,
      reason: 'invalid_request',
      issues: [{ source: 'body', path: ['method'], code: 'invalid_value' }],
    },
    'Expected the unknown method as an issue of the body',
  );
  if (!refusal.message.includes('invalid_request; body.method: invalid_value (')) {
    throw new Error(`Expected the message to locate the issue, received ${refusal.message}`);
  }
});

Deno.test('An ended session refuses its operations as session_not_found', async () => {
  await using emulator = createTestInProcessEmulator();
  const { client } = emulator;
  const { result: session } = await client.createSession();
  await session.end();

  const refusal = await rejectionOf(session.createAccount({ first_name: 'Ada' }));

  if (!(refusal instanceof EmulationControlError) || refusal.reason !== 'session_not_found') {
    throw new Error(`Expected the ended session to be named, received ${refusal}`);
  }
});

Deno.test('A refusal whose body is not a control error keeps its status and raw body', async () => {
  const answers = [
    new Response('Bad gateway', { status: 502 }),
    new Response('{"error":"unavailable"}', {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    }),
    new Response('{"reason":"invalid_request"}', { status: 400 }),
  ];
  for (const answer of answers) {
    const expectedBody = await answer.clone().text();
    const client = new TelegramEmulationClient(PUBLIC_ORIGIN, {
      fetch: () => Promise.resolve(answer),
    });

    const refusal = await rejectionOf(client.createSession());

    if (!(refusal instanceof EmulationClientError) || refusal instanceof EmulationControlError) {
      throw new Error(`Expected a plain client error for ${expectedBody}, received ${refusal}`);
    }
    assertEquals(
      { status: refusal.status, responseBody: refusal.responseBody },
      { status: answer.status, responseBody: expectedBody },
      'Expected the status and the raw body',
    );
  }
});

Deno.test('The body type admits only the shapes the emulator sends', () => {
  // Each constant only type-checks while its shape is not a `ControlErrorBody`.
  const validationFailureNeedsIssues: IsNotControlErrorBody<{ reason: 'invalid_request' }> = true;
  const refusalHasNoIssues: IsNotControlErrorBody<
    { reason: 'bot_blocked'; issues: [ControlRequestIssue] }
  > = true;
  const reasonIsDocumented: IsNotControlErrorBody<{ reason: 'Bot Blocked' }> = true;
  const invalidRequestIsNoRefusal: 'invalid_request' extends ControlRefusalReason ? false : true =
    true;

  assertEquals(
    [
      validationFailureNeedsIssues,
      refusalHasNoIssues,
      reasonIsDocumented,
      invalidRequestIsNoRefusal,
    ],
    [true, true, true, true],
    'Expected every malformed shape to be excluded',
  );
});

Deno.test('A control error refuses a body its contract does not allow', () => {
  const request = { method: 'POST', url: `${PUBLIC_ORIGIN}/sessions`, status: 400 } as const;
  for (const responseBody of ['{"reason":"invalid_request"}', '{"reason":"Bot Blocked"}']) {
    // A JavaScript caller can pass a body its type does not describe, as parsed JSON shows.
    const body: ControlErrorBody = JSON.parse(responseBody);
    let constructionError: unknown;
    try {
      new EmulationControlError('refused', { ...request, responseBody, body });
    } catch (error) {
      constructionError = error;
    }
    if (!(constructionError instanceof TypeError)) {
      throw new Error(`Expected ${responseBody} to be refused as a control error body`);
    }
  }
});

/** `true` when no value of `Value` is a `ControlErrorBody`. */
type IsNotControlErrorBody<Value> = Value extends ControlErrorBody ? false : true;

async function rejectionOf(pending: Promise<unknown>): Promise<unknown> {
  try {
    await pending;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the operation to be refused');
}
