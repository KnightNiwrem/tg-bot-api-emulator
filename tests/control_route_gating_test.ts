import { assertEquals } from '@std/assert';

import { createEmulationApi } from '../src/api/mod.ts';
import { buildSessionServices } from './support/session_services.ts';
import { createVirtualAccount, createVirtualBot } from './support/virtual_users.ts';

const SESSION_NOT_FOUND_BODY = { reason: 'session_not_found' };

Deno.test("a contract route's action that arrives after its session ended changes nothing", async () => {
  using fixture = createGatingFixture();
  const { session, alphaId } = fixture;

  session.end();
  const response = await fixture.api.request(
    `${fixture.sessionPath}/bots/${alphaId}/rate-limit-responses`,
    jsonRequest({ retry_after: 5 }),
  );

  assertEquals(
    {
      status: response.status,
      body: await response.json(),
      receipt: response.headers.has('Action-Receipt-Session-Id'),
      queued: session.botRateLimits.listRateLimitResponses(alphaId),
    },
    {
      status: 404,
      body: SESSION_NOT_FOUND_BODY,
      receipt: false,
      queued: { found: true, responses: [] },
    },
  );
});

Deno.test("a route's action whose body arrives after its session ended changes nothing", async () => {
  using fixture = createGatingFixture();
  const { session, adaId, alphaId } = fixture;
  const messageCountBefore = fixture.countPrivateMessages();
  const body = new TransformStream<Uint8Array, Uint8Array>();
  const bodyWriter = body.writable.getWriter();
  const pendingResponse = fixture.api.request(`${fixture.sessionPath}/accounts/${adaId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body.readable,
  });
  await bodyWriter.write(new TextEncoder().encode(`{"to":{"type":"private","botId":${alphaId}},`));

  // The session ends while the request's body is still arriving, after its session was found.
  session.end();
  await bodyWriter.write(new TextEncoder().encode('"text":"Too late"}'));
  await bodyWriter.close();
  const response = await pendingResponse;

  assertEquals(
    {
      status: response.status,
      body: await response.json(),
      messageCount: fixture.countPrivateMessages(),
    },
    { status: 404, body: SESSION_NOT_FOUND_BODY, messageCount: messageCountBefore },
  );
});

Deno.test('a live session runs the same actions', async () => {
  using fixture = createGatingFixture();
  const { adaId, alphaId } = fixture;
  const messageCountBefore = fixture.countPrivateMessages();

  const queuing = await fixture.api.request(
    `${fixture.sessionPath}/bots/${alphaId}/rate-limit-responses`,
    jsonRequest({ retry_after: 5 }),
  );
  const sending = await fixture.api.request(
    `${fixture.sessionPath}/accounts/${adaId}/messages`,
    jsonRequest({ to: { type: 'private', botId: alphaId }, text: 'Hello' }),
  );
  await queuing.body?.cancel();
  await sending.body?.cancel();

  assertEquals(
    [queuing.status, sending.status, fixture.countPrivateMessages()],
    [201, 201, Number(messageCountBefore) + 1],
  );
});

Deno.test("a route's action whose answer fails to be viewed commits nothing", async () => {
  using fixture = createGatingFixture();
  const { session, adaId, alphaId } = fixture;
  const creation = session.sharedChatAdministration.createSupergroup({
    title: 'Team',
    creatorAccountId: adaId,
  });
  if (!creation.created) {
    throw new Error(`Expected the supergroup to be created: ${creation.reason}`);
  }
  const chatId = creation.supergroup.id;
  session.sharedChatAdministration.addChatMember({
    actorAccountId: adaId,
    chatId,
    memberId: alphaId,
  });
  const readHistoryLength = () => {
    const history = session.supergroupMessaging.getMessageHistory({ accountId: adaId, chatId });
    return history.found ? history.messages.length : history.reason;
  };
  const historyLengthBefore = readHistoryLength();
  const alphaWebhookInfoBefore = session.botUpdateConsumers.getWebhookInfo(fixture.alpha.id);
  const views = session.botMessageViews;
  const viewSupergroupMessage = views.viewSupergroupMessage.bind(views);
  // The message and Alpha's update are staged before the route's view of the message for Ada,
  // which answers the request, fails.
  views.viewSupergroupMessage = (message, observerId) => {
    if (observerId === adaId) {
      throw new Error('The view failed');
    }
    return viewSupergroupMessage(message, observerId);
  };

  const response = await fixture.api.request(
    `${fixture.sessionPath}/accounts/${adaId}/messages`,
    jsonRequest({ to: { type: 'supergroup', chatId }, text: 'Hello' }),
  );
  await response.body?.cancel();
  views.viewSupergroupMessage = viewSupergroupMessage;

  assertEquals(
    [
      response.status,
      readHistoryLength(),
      session.botUpdateConsumers.getWebhookInfo(fixture.alpha.id),
    ],
    [500, historyLengthBefore, alphaWebhookInfoBefore],
  );
});

Deno.test('an inline result chosen as its session ends sends nothing', async () => {
  using fixture = createGatingFixture();
  const { session, adaId, alphaId } = fixture;
  const sending = session.inlineQueries.sendInlineQuery({
    fromAccountId: adaId,
    botId: alphaId,
    chat: { type: 'private', botId: alphaId },
    query: 'a',
    offset: '',
  });
  if (!sending.sent) {
    throw new Error(`Expected the inline query to be sent: ${sending.reason}`);
  }
  const answer = session.inlineQueries.answerInlineQuery({
    fromBotId: alphaId,
    cacheTimeSeconds: 0,
    isPersonal: false,
    nextOffset: '',
    inlineQueryId: sending.inlineQuery.id,
    results: [{
      kind: 'article',
      id: 'a',
      title: 'A',
      description: '',
      url: '',
      messageContent: { kind: 'text', text: 'A' },
    }],
  });
  if (!answer.answered) {
    throw new Error(`Expected the inline query to be answered: ${JSON.stringify(answer)}`);
  }
  const messageCountBefore = fixture.countPrivateMessages();

  // The choice prepares the result's content, then ends its wait in an ended session.
  const choosing = session.inlineQueries.chooseInlineQueryResult({
    accountId: adaId,
    inlineQueryId: sending.inlineQuery.id,
    resultId: 'a',
  });
  session.end();

  assertEquals(
    [await choosing, fixture.countPrivateMessages()],
    [{ chosen: false, reason: 'session_ended' }, messageCountBefore],
  );
});

function jsonRequest(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/**
 * The control API of one session, whose end leaves it registered, as a request that already found
 * its session sees it: Ada has started her private chat with Alpha, an inline bot.
 */
function createGatingFixture() {
  const session = buildSessionServices({ id: 'control-route-gating' });
  const api = createEmulationApi({
    sessionLifecycle: {
      createSession: () => {
        throw new Error('The test creates no session through the API');
      },
      endSession: () => false,
      getSessionById: (sessionId) => sessionId === session.id ? session : undefined,
    },
    publicOrigin: 'http://emulator.test',
  });
  const adaId = createVirtualAccount(session.virtualUsers, { first_name: 'Ada' }).profile.id;
  const alpha = createVirtualBot(session.virtualUsers, {
    first_name: 'Alpha',
    username: 'alpha_bot',
    supports_inline_queries: true,
  }).profile;
  const alphaId = alpha.id;
  const start = session.messageSending.sendAccountPrivateChatMessage({
    fromAccountId: adaId,
    chat: { type: 'private', peerId: alphaId },
    content: { kind: 'text', text: '/start' },
  });
  if (!start.sent) {
    throw new Error(`Expected Ada to start her chat: ${JSON.stringify(start)}`);
  }

  return {
    session,
    api,
    sessionPath: `/sessions/${session.id}`,
    adaId,
    alpha,
    alphaId,
    countPrivateMessages: () => {
      const history = session.privateMessaging.getPrivateMessageHistory({
        accountId: adaId,
        botId: alphaId,
      });
      return history.found ? history.messages.length : history.reason;
    },
    [Symbol.dispose]: () => session[Symbol.dispose](),
  };
}
