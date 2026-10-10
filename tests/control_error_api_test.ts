/**
 * The control API's error bodies: every refusal names a stable `reason`, input that breaks an
 * operation's contract lists its issues, and Bot API responses stay Telegram's.
 */
import { createEmulationApi } from '../src/api/mod.ts';
import { createEmulationSession } from '../src/composition/emulation_session.ts';
import { AccountRepository } from '../src/repositories/account.ts';
import { BotRepository } from '../src/repositories/bot.ts';
import { SessionRepository } from '../src/repositories/session.ts';
import { SessionLifecycleService } from '../src/services/session_lifecycle.ts';
import { VirtualUserService } from '../src/services/virtual_user.ts';
import {
  createSession,
  createTestApi,
  createTestSession,
  requestJson,
  TEST_PUBLIC_ORIGIN,
} from './support/emulation_api.ts';

Deno.test('A body that is not JSON is an invalid_json issue of the whole body', async () => {
  const { api, sessionPath } = await createTestSession();

  const response = await api.request(`${sessionPath}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"first_name": ',
  });

  await assertErrorBody(response, 400, {
    reason: 'invalid_request',
    issues: [{
      source: 'body',
      path: [],
      code: 'invalid_json',
      message: 'The body is not JSON',
    }],
  });
});

Deno.test('A required body without content is not JSON either', async () => {
  const { api, sessionPath } = await createTestSession();

  const response = await api.request(`${sessionPath}/bots`, { method: 'POST' });

  const body = await readErrorBody(response, 400);
  assertJson(
    body.issues?.map(({ source, path, code }) => ({ source, path, code })),
    [{ source: 'body', path: [], code: 'invalid_json' }],
    'Expected a missing body to be an invalid_json issue',
  );
});

Deno.test('Each field a body schema rejects is an issue at its path', async () => {
  const { api, sessionPath } = await createTestSession();

  const { status, body } = await requestJson<ControlErrorBody>(
    api,
    'POST',
    `${sessionPath}/accounts`,
    { nickname: 'Ada', phone_number: '+44' },
  );

  assertStatus(status, 400);
  assertJson(
    body.issues?.map(({ source, path, code }) => ({ source, path, code })),
    [
      { source: 'body', path: ['first_name'], code: 'invalid_type' },
      { source: 'body', path: ['phone_number'], code: 'invalid_format' },
      { source: 'body', path: ['nickname'], code: 'unknown_field' },
    ],
    'Expected the missing, malformed, and unknown fields as issues',
  );
  assertEvery(
    body.issues ?? [],
    (issue) => typeof issue.message === 'string' && issue.message.length > 0,
    'Expected every issue to explain itself',
  );
});

Deno.test('Issues name list positions and never repeat an input value', async () => {
  const { api, sessionPath } = await createTestSession();
  const secretUsername = 'not a username 7f3a9c';

  const response = await api.request(`${sessionPath}/bots`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ first_name: 'Helper', username: secretUsername }),
  });
  const text = await response.text();
  const media = await requestJson<ControlErrorBody>(
    api,
    'POST',
    `${sessionPath}/accounts/1/media-groups`,
    {
      to: { type: 'private', botId: 1 },
      media: [{ photo: { content_base64: 'AA==' } }, { photo: { content_base64: 42 } }],
    },
  );

  assertStatus(response.status, 400);
  if (text.includes(secretUsername) || text.includes('7f3a9c')) {
    throw new Error(`Expected the error body not to repeat the input: ${text}`);
  }
  assertJson(
    JSON.parse(text).issues.map(({ path, code }: ControlRequestIssue) => ({ path, code })),
    [{ path: ['username'], code: 'invalid_value' }],
    'Expected the username refused as an invalid value',
  );
  assertStatus(media.status, 400);
  assertJson(
    media.body.issues?.map(({ path, code }) => ({ path, code })),
    [{ path: ['media', 1, 'photo', 'content_base64'], code: 'invalid_type' }],
    'Expected the issue at the list index of the media it is in',
  );
});

Deno.test('A value meant as one form of a union reports that form’s issues', async () => {
  const { api, sessionPath } = await createTestSession();
  const messagesPath = `${sessionPath}/accounts/1/messages`;
  const to = { type: 'private', botId: 1 };

  const wrongText = await requestJson<ControlErrorBody>(api, 'POST', messagesPath, {
    to,
    text: 42,
  });
  const unknownChatType = await requestJson<ControlErrorBody>(api, 'POST', messagesPath, {
    to: { type: 'channel', chatId: 1 },
    text: 'Hello',
  });
  const unknownContent = await requestJson<ControlErrorBody>(api, 'POST', messagesPath, {
    to,
    sticker: 'cat',
  });

  for (const { status } of [wrongText, unknownChatType, unknownContent]) {
    assertStatus(status, 400);
  }
  assertJson(
    wrongText.body.issues?.map(({ path, code }) => ({ path, code })),
    [{ path: ['text'], code: 'invalid_type' }],
    'Expected a text message with a number as its text to report its text',
  );
  assertJson(
    unknownChatType.body.issues?.map(({ path, code }) => ({ path, code })),
    [{ path: ['to', 'type'], code: 'invalid_value' }],
    'Expected an unknown chat type to be reported at the field that chooses the form',
  );
  assertJson(
    unknownContent.body.issues?.map(({ path, code }) => ({ path, code })),
    [{ path: [], code: 'no_matching_variant' }],
    'Expected content of no known form to match no variant',
  );
});

Deno.test('A malformed path parameter is an issue of the path', async () => {
  const { api, sessionPath } = await createTestSession();

  const { status, body } = await requestJson<ControlErrorBody>(
    api,
    'GET',
    `${sessionPath}/accounts/ada/conversations/private/0/messages`,
  );

  assertStatus(status, 400);
  assertJson(
    body.issues?.map(({ source, path, code }) => ({ source, path, code })),
    [
      { source: 'path', path: ['accountId'], code: 'invalid_type' },
      { source: 'path', path: ['botId'], code: 'too_small' },
    ],
    'Expected each malformed path parameter as an issue',
  );
});

Deno.test('Unknown and repeated query parameters are issues of the query', async () => {
  const { api, sessionPath } = await createTestSession();

  const { status, body } = await requestJson<ControlErrorBody>(
    api,
    'GET',
    `${sessionPath}/bot-activity?after=0&after=0&parameters[text]=a&parameters[text]=b&page=2&limit=-1`,
  );

  assertStatus(status, 400);
  assertJson(
    body.issues?.map(({ source, path, code }) => ({ source, path, code })),
    [
      { source: 'query', path: ['after'], code: 'duplicate_field' },
      { source: 'query', path: ['parameters[text]'], code: 'duplicate_field' },
      { source: 'query', path: ['limit'], code: 'too_small' },
      { source: 'query', path: ['page'], code: 'unknown_field' },
    ],
    'Expected every repeated, malformed, and unknown query parameter as an issue',
  );
});

Deno.test('A read range that cannot be read names the parameter that breaks it', async () => {
  const { api, sessionPath } = await createTestSession();

  const reversed = await requestJson<ControlErrorBody>(
    api,
    'GET',
    `${sessionPath}/bot-activity?after=2&before=1`,
  );
  const beyondHead = await requestJson<ControlErrorBody>(
    api,
    'GET',
    `${sessionPath}/bot-activity?after=5`,
  );

  assertStatus(reversed.status, 400);
  assertJson(
    reversed.body.issues?.map(({ path, code }) => ({ path, code })),
    [{ path: ['before'], code: 'invalid_value' }],
    'Expected a range that ends before it starts to be an issue of its end',
  );
  assertStatus(beyondHead.status, 400);
  assertJson(
    beyondHead.body,
    { reason: 'after_beyond_head' },
    'Expected a position beyond the head to be refused by reason, without issues',
  );
});

Deno.test('Missing resources are refused with the reason that names them', async () => {
  const { api, sessionPath } = await createTestSession();
  const { body: { account } } = await requestJson<{ account: { id: number } }>(
    api,
    'POST',
    `${sessionPath}/accounts`,
    { first_name: 'Ada' },
  );

  const cases: readonly [method: 'DELETE' | 'GET' | 'PUT', path: string, reason: string][] = [
    ['GET', '/sessions/no-such-session/bot-activity', 'session_not_found'],
    ['DELETE', '/sessions/no-such-session', 'session_not_found'],
    [
      'GET',
      `${sessionPath}/accounts/${account.id}/conversations/private/1/messages`,
      'bot_not_found',
    ],
    ['PUT', `${sessionPath}/accounts/999999/blocked-bots/1`, 'account_not_found'],
    ['GET', `${sessionPath}/bots/1/webhook-delivery`, 'bot_not_found'],
    ['GET', `${sessionPath}/bots/not-a-bot/webhook-delivery`, 'bot_not_found'],
    ['GET', `${sessionPath}/files/no-such-file`, 'file_not_found'],
    ['GET', `${sessionPath}/accounts/${account.id}/callback-queries/1`, 'callback_query_not_found'],
  ];
  for (const [method, path, reason] of cases) {
    const { status, body } = await requestJson<ControlErrorBody>(api, method, path);
    assertStatus(status, 404, `${method} ${path}`);
    assertJson(body, { reason }, `Expected ${method} ${path} to be refused as ${reason}`);
  }
});

Deno.test('A path no route serves is refused as route_not_found', async () => {
  const { api, sessionPath } = await createTestSession();

  for (const path of ['/unknown', `${sessionPath}/unknown`, `${sessionPath}/accounts/1/unknown`]) {
    const { status, body } = await requestJson<ControlErrorBody>(api, 'GET', path);
    assertStatus(status, 404, path);
    assertJson(body, { reason: 'route_not_found' }, `Expected ${path} to name no route`);
  }
});

Deno.test('A conflict with the session state is refused by its reason', async () => {
  const { api, sessionPath } = await createTestSession();
  await requestJson(api, 'POST', `${sessionPath}/bots`, {
    first_name: 'Helper',
    username: 'helper_bot',
  });

  const { status, body } = await requestJson<ControlErrorBody>(
    api,
    'POST',
    `${sessionPath}/bots`,
    { first_name: 'Other', username: 'Helper_Bot' },
  );

  assertStatus(status, 409);
  assertJson(body, { reason: 'username_taken' }, 'Expected a taken username to conflict');
});

Deno.test('A failure outside the 4xx range carries its reason too', async () => {
  const api = createEmulationApi({
    sessionLifecycle: createExhaustedIdentityLifecycle(),
    publicOrigin: TEST_PUBLIC_ORIGIN,
  });
  const sessionPath = await createSession(api);

  const { status, body } = await requestJson<ControlErrorBody>(
    api,
    'POST',
    `${sessionPath}/accounts`,
    { first_name: 'Ada' },
  );

  assertStatus(status, 507);
  assertJson(
    body,
    { reason: 'identity_limit_reached' },
    'Expected a session without user IDs left to refuse the account by reason',
  );
});

Deno.test('Bot API answers for an unknown session keep their empty 404', async () => {
  const api = createTestApi();

  for (
    const path of [
      '/sessions/no-such-session/bot-api/bot1:token/getMe',
      '/sessions/no-such-session/bot-api/file/bot1:token/photos/file_0.jpg',
      '/sessions/no-such-session/bot-api',
    ]
  ) {
    const response = await api.request(path, { method: 'POST' });
    assertStatus(response.status, 404, path);
    const body = new Uint8Array(await response.arrayBuffer());
    if (body.length !== 0 || response.headers.get('Content-Type') !== null) {
      throw new Error(`Expected ${path} to answer without a body, as before control error bodies`);
    }
  }
});

Deno.test('Bot API errors of a known session keep Telegram’s bytes', async () => {
  const { api, sessionPath } = await createTestSession();

  const unauthorized = await api.request(`${sessionPath}/bot-api/bot1:token/getMe`);
  const withoutMethod = await api.request(`${sessionPath}/bot-api/bot1:token`);

  assertStatus(unauthorized.status, 401);
  assertText(
    await unauthorized.text(),
    '{"ok":false,"error_code":401,"description":"Unauthorized"}',
    'Expected an unknown token to be answered exactly as Telegram answers it',
  );
  assertStatus(withoutMethod.status, 404);
  assertText(
    await withoutMethod.text(),
    '{"ok":false,"error_code":404,"description":"Not Found"}',
    'Expected a path without a method to be answered exactly as Telegram answers it',
  );
});

interface ControlRequestIssue {
  readonly source: string;
  readonly path: readonly (string | number)[];
  readonly code: string;
  readonly message: string;
}

interface ControlErrorBody {
  readonly reason: string;
  readonly issues?: readonly ControlRequestIssue[];
}

/** Sessions whose accounts can never get a user ID, as if every ID were taken. */
function createExhaustedIdentityLifecycle(): SessionLifecycleService {
  return new SessionLifecycleService({
    sessionRepository: new SessionRepository(),
    createEmulationSession: (id, options) => ({
      ...createEmulationSession(id, options),
      virtualUsers: new VirtualUserService({
        identities: {
          reserveIdentity: () => ({ reserved: false, reason: 'identity_limit_reached' }),
        },
        accounts: new AccountRepository(),
        bots: new BotRepository(),
      }),
    }),
    generateSessionId: () => crypto.randomUUID(),
  });
}

async function readErrorBody(response: Response, status: number): Promise<ControlErrorBody> {
  assertStatus(response.status, status);
  if (response.headers.get('Content-Type')?.startsWith('application/json') !== true) {
    throw new Error(`Expected a JSON error body, received ${response.headers.get('Content-Type')}`);
  }
  return await response.json();
}

async function assertErrorBody(
  response: Response,
  status: number,
  expected: ControlErrorBody,
): Promise<void> {
  assertJson(await readErrorBody(response, status), expected, 'Expected the error body');
}

function assertStatus(actual: number, expected: number, context = 'the request'): void {
  if (actual !== expected) {
    throw new Error(`Expected ${context} to answer ${expected}, received ${actual}`);
  }
}

function assertJson(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: received ${JSON.stringify(actual)}`);
  }
}

function assertText(actual: string, expected: string, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: received ${actual}`);
  }
}

function assertEvery<T>(values: readonly T[], predicate: (value: T) => boolean, message: string) {
  if (!values.every(predicate)) {
    throw new Error(`${message}: received ${JSON.stringify(values)}`);
  }
}
