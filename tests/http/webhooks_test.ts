import { assertEquals } from '@std/assert';
import { Bot } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/bot.ts';
import {
  webhookCallback,
} from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/convenience/webhook.ts';

import { TEST_PUBLIC_ORIGIN } from '../support/emulation_api.ts';
import { assertEqualsInFieldOrder } from '../support/field_order_assertion.ts';
import { expectSettlementWithin } from '../support/settlement.ts';
import {
  isBadRequestResponse,
  isGetUpdatesResponse,
  isMessageHistoryResponse,
} from '../support/http_response_guards.ts';
import { botApiResult, callBotApi, callBotApiWithFiles } from '../support/bot_api_requests.ts';
import { createPrivateConversationFixture } from '../support/http_fixtures.ts';

Deno.test('deleteWebhook answers as Telegram does for a bot without a webhook', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, botApiPath, sendText } = fixture;
  const deleteWebhook = async (parameters: Record<string, unknown>) => {
    const response = await api.request(`${botApiPath}/deleteWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parameters),
    });
    return { status: response.status, body: await response.json() };
  };
  const getPendingTexts = async () => {
    const response = await api.request(`${botApiPath}/getUpdates`);
    const body: unknown = await response.json();
    if (!isGetUpdatesResponse(body)) {
      throw new Error('Expected a getUpdates response');
    }
    return body.result.map((update) => update.message.text);
  };
  const expectedAnswer = { ok: true, result: true, description: 'Webhook is already deleted' };

  await sendText('kept');
  const keepingAnswer = await deleteWebhook({});
  if (keepingAnswer.status !== 200) {
    throw new Error('Expected deleteWebhook to succeed without discarding pending updates');
  }
  assertEqualsInFieldOrder(
    keepingAnswer.body,
    expectedAnswer,
    'Expected deleteWebhook to succeed without discarding pending updates',
  );
  assertEquals(
    await getPendingTexts(),
    ['kept'],
    'Expected deleteWebhook to succeed without discarding pending updates',
  );

  const droppingAnswer = await deleteWebhook({ drop_pending_updates: true });
  if (
    droppingAnswer.status !== 200 ||
    (await getPendingTexts()).length !== 0
  ) {
    throw new Error('Expected drop_pending_updates to discard pending updates');
  }
  assertEqualsInFieldOrder(
    droppingAnswer.body,
    expectedAnswer,
    'Expected drop_pending_updates to discard pending updates',
  );

  const malformedAnswer = await deleteWebhook({ drop_pending_updates: 'maybe' });
  if (malformedAnswer.status !== 400 || !isBadRequestResponse(malformedAnswer.body)) {
    throw new Error('Expected a malformed drop_pending_updates to be rejected');
  }
});

Deno.test('setWebhook, getWebhookInfo, and deleteWebhook follow Telegram checks', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, botApiPath } = fixture;
  const webhookUrl = 'https://bot.example/webhook';
  const expectAnswer = (
    answer: { status: number; body: unknown },
    expected: { status: number; body: unknown },
    failureMessage: string,
  ) => {
    assertEqualsInFieldOrder(answer, expected, `${failureMessage}`);
  };
  const success = (description: string) => ({
    status: 200,
    body: { ok: true, result: true, description },
  });
  const failure = (status: number, description: string) => ({
    status,
    body: { ok: false, error_code: status, description },
  });

  try {
    const heldPoll = callBotApi(api, `${botApiPath}/getUpdates`, { timeout: 50 });
    expectAnswer(
      await callBotApi(api, `${botApiPath}/setWebhook`, {
        url: webhookUrl,
        secret_token: 'webhook_secret',
        allowed_updates: ['message'],
      }),
      success('Webhook was set'),
      'Expected setWebhook to set the webhook',
    );
    expectAnswer(
      await heldPoll,
      failure(409, 'Conflict: terminated by setWebhook request'),
      'Expected setWebhook to terminate the held long poll',
    );
    expectAnswer(
      await callBotApi(api, `${botApiPath}/getUpdates`, {}),
      failure(
        409,
        "Conflict: can't use getUpdates method while webhook is active; use deleteWebhook to delete the webhook first",
      ),
      'Expected getUpdates to fail while the webhook is set',
    );
    expectAnswer(
      await callBotApi(api, `${botApiPath}/setWebhook`, {
        url: webhookUrl,
        secret_token: 'webhook_secret',
      }),
      success('Webhook is already set'),
      'Expected an unchanged webhook to be already set',
    );
    expectAnswer(
      await callBotApi(api, `${botApiPath}/getWebhookInfo`, {}),
      {
        status: 200,
        body: {
          ok: true,
          result: {
            url: webhookUrl,
            has_custom_certificate: false,
            pending_update_count: 0,
            max_connections: 40,
            allowed_updates: ['message'],
          },
        },
      },
      'Expected getWebhookInfo to report the webhook and its subscription',
    );

    const rejections: Array<[Record<string, unknown>, string]> = [
      [{ url: 'ftp://bot.example/webhook' }, 'Bad Request: invalid webhook URL specified'],
      [
        { url: webhookUrl, secret_token: 'not allowed' },
        'Bad Request: secret token contains illegal characters',
      ],
      [
        { url: webhookUrl, ip_address: '203.0.113.1' },
        'Bad Request: webhook IP addresses are not supported',
      ],
      [
        { url: webhookUrl, max_connections: 'many' },
        'Bad Request: invalid setWebhook parameters: max_connections',
      ],
    ];
    for (const [parameters, description] of rejections) {
      expectAnswer(
        await callBotApi(api, `${botApiPath}/setWebhook`, parameters),
        failure(400, description),
        `Expected setWebhook to reject ${JSON.stringify(parameters)}`,
      );
    }
    expectAnswer(
      await callBotApiWithFiles(api, `${botApiPath}/setWebhook`, { url: webhookUrl }, {
        certificate: new File(['certificate'], 'certificate.pem'),
      }),
      failure(400, 'Bad Request: custom webhook certificates are not supported'),
      'Expected setWebhook to reject a custom certificate',
    );

    // Telegram clamps max_connections to its range.
    await callBotApi(api, `${botApiPath}/setWebhook`, { url: webhookUrl, max_connections: 1000 });
    const { body: clampedInfo } = await callBotApi(api, `${botApiPath}/getWebhookInfo`, {});
    if (botApiResult(clampedInfo)?.max_connections !== 100) {
      throw new Error('Expected max_connections to be clamped to 100');
    }

    expectAnswer(
      await callBotApi(api, `${botApiPath}/deleteWebhook`, {}),
      success('Webhook was deleted'),
      'Expected deleteWebhook to delete the webhook',
    );
    expectAnswer(
      await callBotApi(api, `${botApiPath}/deleteWebhook`, {}),
      success('Webhook is already deleted'),
      'Expected a second deleteWebhook to find no webhook',
    );
    const { status: pollingStatus } = await callBotApi(api, `${botApiPath}/getUpdates`, {});
    if (pollingStatus !== 200) {
      throw new Error(`Expected getUpdates to work after deleteWebhook, received ${pollingStatus}`);
    }
  } finally {
    await api.request(sessionPath, { method: 'DELETE' });
  }
});

Deno.test('a grammY bot receives updates through its webhook and replies', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, createdBot, createdAccount, sendText } = fixture;
  const grammyBot = new Bot(createdBot.token, {
    client: {
      apiRoot: `${TEST_PUBLIC_ORIGIN}${sessionPath}/bot-api`,
      fetch: api.fetch,
    },
  });
  const firstReply = Promise.withResolvers<void>();
  grammyBot.command('start', async (context) => {
    await context.reply(`Hello, ${context.from?.first_name}!`);
    firstReply.resolve();
  });
  const handleWebhookRequest = webhookCallback(grammyBot, 'std/http', {
    secretToken: 'webhook_secret',
  });
  // Deno.serve passes no request to a handler that declares no parameter, as grammY's does.
  const webhookServer = Deno.serve(
    { hostname: '127.0.0.1', port: 0, onListen: () => {} },
    (request) => handleWebhookRequest(request),
  );
  const webhookUrl = `http://127.0.0.1:${webhookServer.addr.port}/webhook`;

  try {
    await grammyBot.api.setWebhook(webhookUrl, { secret_token: 'webhook_secret' });
    await sendText('/start');
    await expectSettlementWithin(
      firstReply.promise,
      5_000,
      'Expected the bot to reply to a command delivered to its webhook',
    );
    const historyBody: unknown = await (await api.request(
      `${sessionPath}/accounts/${createdAccount.account.id}/conversations/private/${createdBot.bot.id}/messages`,
    )).json();
    if (!isMessageHistoryResponse(historyBody)) {
      throw new Error('Expected history to hold the command and the bot reply');
    }
    assertEquals(
      historyBody.messages.map(({ text }) => text),
      ['/start', 'Hello, Ada!'],
      'Expected history to hold the command and the bot reply',
    );

    // The bot rejects updates without its secret token, which the test reads from getWebhookInfo.
    await grammyBot.api.setWebhook(webhookUrl, { secret_token: 'other_secret' });
    await sendText('/start again');
    const lastErrorMessage = await expectSettlementWithin(
      (async () => {
        for (;;) {
          const { last_error_message } = await grammyBot.api.getWebhookInfo();
          if (last_error_message !== undefined) {
            return last_error_message;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      })(),
      1_000,
      'Expected the rejected update to be reported',
    );
    if (lastErrorMessage !== 'Wrong response from the webhook: 401 Unauthorized') {
      throw new Error(`Expected the bot to reject the wrong secret, received ${lastErrorMessage}`);
    }
  } finally {
    await api.request(sessionPath, { method: 'DELETE' });
    await webhookServer.shutdown();
  }
});

Deno.test('a webhook runs a Bot API method by naming it in its response', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, botApiPath, createdBot, createdAccount, sendText } = fixture;
  const accountId = createdAccount.account.id;
  const replies = [
    Response.json({ method: 'sendMessage', chat_id: accountId, text: 'JSON reply' }),
    // A reply cannot change the webhook.
    Response.json({ method: 'setWebhook', url: '' }),
    new Response(
      new URLSearchParams({
        method: 'SENDMESSAGE',
        chat_id: String(accountId),
        text: 'Form reply',
      }),
    ),
    new Response('ok'),
    // A failing method changes nothing, and the update still counts as delivered.
    Response.json({ method: 'sendMessage', chat_id: 999, text: 'Lost reply' }),
  ];
  let requestCount = 0;
  const webhookServer = Deno.serve(
    { hostname: '127.0.0.1', port: 0, onListen: () => {} },
    () => replies[requestCount++] ?? new Response(null),
  );
  const readHistory = async () =>
    ((await (await api.request(
      `${sessionPath}/accounts/${accountId}/conversations/private/${createdBot.bot.id}/messages`,
    )).json()) as { messages: Array<{ text?: string }> }).messages.map(({ text }) => text);
  const readWebhookInfo = async () =>
    (await callBotApi(api, `${botApiPath}/getWebhookInfo`, {})).body as {
      result: { url: string; pending_update_count: number; last_error_message?: string };
    };

  try {
    await callBotApi(api, `${botApiPath}/setWebhook`, {
      url: `http://127.0.0.1:${webhookServer.addr.port}/webhook`,
    });
    for (const [index, text] of ['one', 'two', 'three', 'four', 'five'].entries()) {
      await sendText(text);
      await expectSettlementWithin(
        (async () => {
          while (
            requestCount <= index || (await readWebhookInfo()).result.pending_update_count > 0
          ) {
            await new Promise((resolve) => setTimeout(resolve, 5));
          }
        })(),
        1_000,
        `Expected the webhook to accept the update of "${text}"`,
      );
    }

    const history = await readHistory();
    const { result: webhookInfo } = await readWebhookInfo();
    if (
      webhookInfo.url.length === 0 ||
      webhookInfo.last_error_message !== undefined
    ) {
      throw new Error(
        `Expected the webhook's replies to run, received ${
          JSON.stringify({ history, webhookInfo })
        }`,
      );
    }
    assertEquals(
      history,
      ['one', 'JSON reply', 'two', 'three', 'Form reply', 'four', 'five'],
      "Expected the webhook's replies to run",
    );
  } finally {
    await api.request(sessionPath, { method: 'DELETE' });
    await webhookServer.shutdown();
  }
});

Deno.test('a grammY bot replies through its webhook response', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, createdBot, createdAccount, sendText } = fixture;
  const grammyBot = new Bot(createdBot.token, {
    client: {
      apiRoot: `${TEST_PUBLIC_ORIGIN}${sessionPath}/bot-api`,
      fetch: api.fetch,
      canUseWebhookReply: (method) => method === 'sendMessage',
    },
  });
  grammyBot.command('start', (context) => context.reply('Hello through the webhook reply!'));
  const handleWebhookRequest = webhookCallback(grammyBot, 'std/http');
  const webhookServer = Deno.serve(
    { hostname: '127.0.0.1', port: 0, onListen: () => {} },
    (request) => handleWebhookRequest(request),
  );
  const historyPath =
    `${sessionPath}/accounts/${createdAccount.account.id}/conversations/private/${createdBot.bot.id}/messages`;

  try {
    await grammyBot.api.setWebhook(`http://127.0.0.1:${webhookServer.addr.port}/webhook`);
    await sendText('/start');
    const history = await expectSettlementWithin(
      (async () => {
        for (;;) {
          const { messages } = await (await api.request(historyPath)).json() as {
            messages: Array<{ text?: string }>;
          };
          if (messages.length > 1) {
            return messages.map(({ text }) => text);
          }
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      })(),
      5_000,
      'Expected the bot to reply in its webhook response',
    );
    assertEquals(
      history,
      ['/start', 'Hello through the webhook reply!'],
      'Expected the reply in history',
    );
  } finally {
    await api.request(sessionPath, { method: 'DELETE' });
    await webhookServer.shutdown();
  }
});
