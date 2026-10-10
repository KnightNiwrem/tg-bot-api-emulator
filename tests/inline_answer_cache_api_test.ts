import { Bot } from 'grammy';
import { run } from '@grammyjs/runner';

import {
  EmulationClientError,
  type EmulationSessionClient,
  type InlineQuery,
  type LocationInput,
  type PrivateMessageTarget,
  type SendInlineQueryInput,
  TelegramEmulationClient,
  type VirtualAccountClient,
} from '../clients/typescript/mod.ts';
import { createTestApi, TEST_PUBLIC_ORIGIN } from './support/emulation_api.ts';

Deno.test('a test expires a cached inline answer, and the next query reaches the bot', async () => {
  const { session, ada, grace, bot, privateChat, callBot, takeInlineQueryUpdates } =
    await createInlineCacheFixture();
  try {
    const sendQuery = (account: VirtualAccountClient, query = 'cats') =>
      account.sendInlineQuery({ bot_id: bot.id, chat: privateChat, query });
    const original = await sendQuery(ada);
    const delivered = await takeInlineQueryUpdates();
    const answer = await callBot('answerInlineQuery', {
      inline_query_id: original.id,
      results: [article('cats')],
      cache_time: 300,
    });
    const ownCopy = await sendQuery(ada, ' cats\n');
    const otherCopy = await sendQuery(grace);
    const deliveredForCopies = await takeInlineQueryUpdates();
    const messagesBeforeExpiry = await ada.getMessages({ chat: privateChat });
    const pendingBeforeExpiry = await countPendingUpdates(callBot);

    // Any query of the request selects it: here, the other account's reused answer.
    const expiry = await expiryOutcome(session, otherCopy.id);
    const keptQueries = [
      await ada.getInlineQuery(original.id),
      await ada.getInlineQuery(ownCopy.id),
      await grace.getInlineQuery(otherCopy.id),
    ].map(({ status, answer }) => [status, answer?.results.map(({ id }) => id)]);
    const messagesAfterExpiry = await ada.getMessages({ chat: privateChat });
    const pendingAfterExpiry = await countPendingUpdates(callBot);
    const reanswer = await callBot('answerInlineQuery', {
      inline_query_id: ownCopy.id,
      results: [article('dogs')],
    });
    const fresh = await sendQuery(ada);
    const deliveredAfterExpiry = await takeInlineQueryUpdates();
    const sent = await grace.chooseInlineQueryResult({
      inline_query_id: otherCopy.id,
      result_id: 'cats',
    });

    expectEqual(
      [
        delivered,
        answer.status,
        [ownCopy.status, otherCopy.status],
        deliveredForCopies,
        expiry,
        keptQueries,
        messagesAfterExpiry,
        pendingAfterExpiry,
        [reanswer.status, reanswer.body.description],
        fresh.status,
        deliveredAfterExpiry,
        sent.text,
      ],
      [
        [original.id],
        200,
        ['answered', 'answered'],
        [],
        'expired',
        Array(3).fill(['answered', ['cats']]),
        messagesBeforeExpiry,
        pendingBeforeExpiry,
        [400, 'Bad Request: query is too old and response timeout expired or query ID is invalid'],
        'awaiting_answer',
        [fresh.id],
        'Result cats',
      ],
      'Expected the expiry to send the next query to the bot and leave answers, messages and ' +
        'updates as they were',
    );
  } finally {
    await session.end();
  }
});

Deno.test('answer cache expiry follows the request, not the chat, and stays in its session', async () => {
  const api = createTestApi();
  const first = await createInlineCacheFixture(api);
  const second = await createInlineCacheFixture(api);
  try {
    const supergroups = await Promise.all(
      ['Team', 'Club'].map((title) => first.ada.createSupergroup({ title })),
    );
    const [teamChat, clubChat] = supergroups.map(({ id }) =>
      ({ type: 'supergroup', chatId: id }) as const
    );
    const near = (latitude: number): LocationInput => ({ latitude, longitude: 0.5 });
    const sendQuery = (fixture: InlineCacheFixture, input: Partial<SendInlineQueryInput>) =>
      fixture.ada.sendInlineQuery({
        bot_id: fixture.bot.id,
        chat: fixture.privateChat,
        query: 'cafés',
        location: near(51.50071),
        ...input,
      });
    const answerQuery = async (fixture: InlineCacheFixture, inlineQuery: InlineQuery) => {
      await fixture.callBot('answerInlineQuery', {
        inline_query_id: inlineQuery.id,
        results: [article(inlineQuery.id)],
      });
    };
    // TDLib keys a location in whole ten-thousandths of a degree, so 51.50071 and 51.50079 share
    // a request, and 51.50085 does not.
    const requestQuery = () => sendQuery(first, { chat: teamChat, location: near(51.50079) });
    const otherRequests: readonly Partial<SendInlineQueryInput>[] = [
      { chat: teamChat, location: near(51.50085) },
      { chat: teamChat, location: undefined },
      { chat: teamChat, offset: '10' },
      { chat: teamChat, query: 'tea' },
      {},
    ];
    for (const input of [{ chat: teamChat }, ...otherRequests]) {
      await answerQuery(first, await sendQuery(first, input));
    }
    await answerQuery(second, await sendQuery(second, {}));

    // A query in another supergroup selects the same request, which names no chat.
    const selector = await sendQuery(first, { chat: clubChat, query: 'cafés ' });
    const expiry = await expiryOutcome(first.session, selector.id);
    const expiredRequest = (await requestQuery()).status;
    const otherStatuses = [];
    for (const input of otherRequests) {
      otherStatuses.push((await sendQuery(first, input)).status);
    }
    const otherSession = (await sendQuery(second, {})).status;

    expectEqual(
      [selector.status, expiry, expiredRequest, otherStatuses, otherSession],
      [
        'answered',
        'expired',
        'awaiting_answer',
        Array(otherRequests.length).fill('answered'),
        'answered',
      ],
      "Expected only the request's answers in its session to expire",
    );
  } finally {
    await first.session.end();
    await second.session.end();
  }
});

Deno.test('answer cache expiry is refused, changing nothing, when there is no answer to expire', async () => {
  const api = createTestApi();
  const { session, ada, bot, privateChat, callBot, takeInlineQueryUpdates } =
    await createInlineCacheFixture(api);
  try {
    const sendQuery = (query: string) =>
      ada.sendInlineQuery({ bot_id: bot.id, chat: privateChat, query });
    const answerQuery = (inlineQuery: InlineQuery, cacheTimeSeconds?: number) =>
      callBot('answerInlineQuery', {
        inline_query_id: inlineQuery.id,
        results: [article('1')],
        ...(cacheTimeSeconds === undefined ? {} : { cache_time: cacheTimeSeconds }),
      });
    const cachedQuery = await sendQuery('cats');
    await answerQuery(cachedQuery);
    const unanswered = await sendQuery('dogs');
    const uncachedQuery = await sendQuery('tea');
    await answerQuery(uncachedQuery, 0);
    await takeInlineQueryUpdates();

    const refusals = [
      await expiryOutcome(session, '999'),
      await expiryOutcome(session, 'not an id'),
      await expiryOutcome(session, unanswered.id),
      await expiryOutcome(session, uncachedQuery.id),
      (await api.request(`/sessions/unknown/inline-queries/${cachedQuery.id}/answer-cache/expiry`, {
        method: 'POST',
      })).status,
    ];
    const reusedAfterRefusals = (await sendQuery('cats')).status;
    const expiry = await expiryOutcome(session, cachedQuery.id);
    const repeated = await expiryOutcome(session, cachedQuery.id);
    const deliveredAfterExpiry = (await takeInlineQueryUpdates()).length;
    const fresh = await sendQuery('cats');

    expectEqual(
      [refusals, reusedAfterRefusals, expiry, repeated, deliveredAfterExpiry, fresh.status],
      [[404, 404, 409, 409, 404], 'answered', 'expired', 409, 0, 'awaiting_answer'],
      'Expected refused expiries to keep the cached answer and a repeated expiry to be refused',
    );
  } finally {
    await session.end();
  }
});

Deno.test("a bot's answer after an expiry fills the cache again", async () => {
  const { session, fetch, ada, bot, privateChat } = await createInlineCacheFixture();
  const answerGate = Promise.withResolvers<void>();
  const grammyBot = new Bot(bot.token, { client: { apiRoot: session.botApiRoot, fetch } });
  let answerCount = 0;
  grammyBot.on('inline_query', async (context) => {
    const answerNumber = ++answerCount;
    // The second answer waits until the test has expired the cache.
    if (answerNumber === 2) {
      await answerGate.promise;
    }
    await context.answerInlineQuery([article(`answer-${answerNumber}`)], { cache_time: 300 });
  });
  const activity = session.botActivity({ bot_id: bot.id });
  const runner = run(grammyBot);
  try {
    const sendQuery = () =>
      ada.sendInlineQuery({ bot_id: bot.id, chat: privateChat, query: 'cats' });
    const waitForAnswer = async (inlineQuery: InlineQuery, after: number) => {
      await activity.waitFor(
        { method: 'answerInlineQuery', ok: true, parameters: { inline_query_id: inlineQuery.id } },
        { after },
      );
      return (await ada.getInlineQuery(inlineQuery.id)).answer?.results[0]?.id;
    };

    const beforeFirst = await activity.position();
    const first = await sendQuery();
    const firstAnswer = await waitForAnswer(first, beforeFirst);
    await session.expireInlineAnswerCache(first.id);
    const beforeLate = await activity.position();
    const late = await sendQuery();
    await activity.waitFor({ kind: 'update_delivered' }, { after: beforeLate });
    // The bot holds its answer to the late query, so nothing is cached to expire.
    const whileAnswerHeld = await expiryOutcome(session, late.id);
    answerGate.resolve();
    const lateAnswer = await waitForAnswer(late, beforeLate);
    const reused = await sendQuery();

    expectEqual(
      [firstAnswer, late.status, whileAnswerHeld, lateAnswer, reused.status, reused.answer],
      [
        'answer-1',
        'awaiting_answer',
        409,
        'answer-2',
        'answered',
        (await ada.getInlineQuery(late.id)).answer,
      ],
      'Expected the answer given after the expiry to be reused',
    );
  } finally {
    answerGate.resolve();
    await runner.stop();
    await session.end();
  }
});

type BotApiCaller = (
  method: string,
  parameters: Record<string, unknown>,
) => Promise<{ readonly status: number; readonly body: TestBotApiResponse }>;

interface TestBotApiResponse {
  readonly ok: boolean;
  readonly result?: unknown;
  readonly description?: string;
}

interface InlineCacheFixture {
  readonly session: EmulationSessionClient;
  readonly fetch: typeof globalThis.fetch;
  readonly bot: { readonly id: number; readonly token: string };
  readonly ada: VirtualAccountClient;
  readonly grace: VirtualAccountClient;
  readonly privateChat: PrivateMessageTarget;
  readonly callBot: BotApiCaller;
  /** Confirms the updates waiting for the bot and returns the IDs of the inline queries. */
  readonly takeInlineQueryUpdates: () => Promise<readonly string[]>;
}

/**
 * Creates a session where Ada and Grace can type inline queries for an inline bot that requests
 * their location, which the test drives through its Bot API unless it starts a grammY bot.
 */
async function createInlineCacheFixture(api = createTestApi()): Promise<InlineCacheFixture> {
  const fetch: typeof globalThis.fetch = async (input, init) =>
    await api.fetch(new Request(input, init));
  const session = await new TelegramEmulationClient(TEST_PUBLIC_ORIGIN, { fetch }).createSession();
  const createdBot = await session.createBot({
    first_name: 'Inline Bot',
    username: 'inline_bot',
    supports_inline_queries: true,
    requests_inline_location: true,
  });
  const { account: ada } = await session.createAccount({ first_name: 'Ada' });
  const { account: grace } = await session.createAccount({ first_name: 'Grace' });
  const callBot = callBotWith(fetch, session, createdBot.token);
  let nextUpdateOffset = 0;
  return {
    session,
    fetch,
    bot: { id: createdBot.bot.id, token: createdBot.token },
    ada,
    grace,
    privateChat: { type: 'private', botId: createdBot.bot.id },
    callBot,
    takeInlineQueryUpdates: async () => {
      const { body } = await callBot('getUpdates', { offset: nextUpdateOffset, timeout: 0 });
      const updates = body.result as readonly {
        readonly update_id: number;
        readonly inline_query?: { readonly id: string };
      }[];
      nextUpdateOffset = (updates.at(-1)?.update_id ?? nextUpdateOffset - 1) + 1;
      return updates.flatMap(({ inline_query }) =>
        inline_query === undefined ? [] : [inline_query.id]
      );
    },
  };
}

function callBotWith(
  fetch: typeof globalThis.fetch,
  session: EmulationSessionClient,
  token: string,
): BotApiCaller {
  return async (method, parameters) => {
    const response = await fetch(`${session.botApiRoot}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parameters),
    });
    return { status: response.status, body: await response.json() };
  };
}

function article(id: string) {
  return {
    type: 'article',
    id,
    title: `Result ${id}`,
    input_message_content: { message_text: `Result ${id}` },
  } as const;
}

/** `'expired'` for an expiry that succeeded, or the HTTP status it failed with. */
async function expiryOutcome(
  session: EmulationSessionClient,
  inlineQueryId: string,
): Promise<'expired' | number | undefined> {
  try {
    await session.expireInlineAnswerCache(inlineQueryId);
    return 'expired';
  } catch (error) {
    if (error instanceof EmulationClientError) {
      return error.status;
    }
    throw error;
  }
}

/** How many updates wait for the bot, read without confirming any. */
async function countPendingUpdates(callBot: BotApiCaller): Promise<number> {
  const { body } = await callBot('getUpdates', { timeout: 0 });
  return (body.result as unknown[]).length;
}

function expectEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}
