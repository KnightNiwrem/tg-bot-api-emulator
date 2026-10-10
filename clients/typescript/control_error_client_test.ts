import { createEmulationApi } from '../../src/api/mod.ts';
import { createSessionLifecycleService } from '../../src/composition/session_lifecycle.ts';
import { EmulationClientError, EmulationControlError, TelegramEmulationClient } from './mod.ts';

const PUBLIC_ORIGIN = 'http://emulator.example:9000';

Deno.test('A refusal rejects with an EmulationControlError naming its reason', async () => {
  const { client } = createInProcessClient();
  const session = await client.createSession();
  await session.createBot({ first_name: 'Shop', username: 'shop_bot' });

  const refusal = await rejectionOf(
    session.createBot({ first_name: 'Other shop', username: 'Shop_Bot' }),
  );

  if (!(refusal instanceof EmulationControlError) || !(refusal instanceof EmulationClientError)) {
    throw new Error(`Expected a control error, which is a client error, received ${refusal}`);
  }
  assertJson(
    {
      name: refusal.name,
      method: refusal.method,
      status: refusal.status,
      reason: refusal.reason,
      issues: refusal.issues,
      responseBody: refusal.responseBody,
    },
    {
      name: 'EmulationControlError',
      method: 'POST',
      status: 409,
      reason: 'username_taken',
      issues: [],
      responseBody: '{"reason":"username_taken"}',
    },
    'Expected the refusal with its status, reason, and raw body',
  );
  if (!refusal.message.endsWith('returned HTTP 409; expected 201: username_taken')) {
    throw new Error(`Expected the message to name the reason, received ${refusal.message}`);
  }
});

Deno.test('Input the emulator rejects lists each issue on the control error', async () => {
  const { client } = createInProcessClient();
  const session = await client.createSession();
  const { bot } = await session.createBot({ first_name: 'Shop', username: 'shop_bot' });

  const refusal = await rejectionOf(
    session.queueServerErrorResponses({ bot_id: bot.id, method: 'sendTelepathy', error_code: 500 }),
  );

  if (!(refusal instanceof EmulationControlError)) {
    throw new Error(`Expected a control error, received ${refusal}`);
  }
  assertJson(
    {
      status: refusal.status,
      reason: refusal.reason,
      issues: refusal.issues.map(({ source, path, code }) => ({ source, path, code })),
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
  const { client } = createInProcessClient();
  const session = await client.createSession();
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
    assertJson(
      { status: refusal.status, responseBody: refusal.responseBody },
      { status: answer.status, responseBody: expectedBody },
      'Expected the status and the raw body',
    );
  }
});

function createInProcessClient() {
  const api = createEmulationApi({
    sessionLifecycle: createSessionLifecycleService(),
    publicOrigin: PUBLIC_ORIGIN,
  });
  const client = new TelegramEmulationClient(PUBLIC_ORIGIN, {
    fetch: async (input, init) => await api.fetch(new Request(input, init)),
  });
  return { client };
}

async function rejectionOf(pending: Promise<unknown>): Promise<unknown> {
  try {
    await pending;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the operation to be refused');
}

function assertJson(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: received ${JSON.stringify(actual)}`);
  }
}
