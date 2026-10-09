import { Bot } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/bot.ts';
import { run } from '@grammyjs/runner/runner.ts';

import {
  EmulationClientError,
  type EmulationSessionClient,
  type MessageDraft,
  type PrivateMessageTarget,
  TelegramEmulationClient,
  type VirtualAccountClient,
} from '../clients/typescript/mod.ts';
import { messageDraftResponseSchema } from '../clients/typescript/schemas.ts';
import { createTestApi, type EmulationApi, TEST_PUBLIC_ORIGIN } from './support/emulation_api.ts';

/** The most characters of message text Telegram accepts. */
const MAX_TEXT_LENGTH = 4_096;

Deno.test('a bot streams drafts that its account sees apart from the chat history', async () => {
  const { session, bot, ada, privateChat, callBot } = await createDraftFixture();
  try {
    const historyBefore = await ada.getMessages({ chat: privateChat });
    const drafts: (MessageDraft | null)[] = [await ada.getMessageDraft({ chat: privateChat })];
    const writes = [
      { chat_id: ada.id, draft_id: 7 },
      { chat_id: ada.id, draft_id: 7, text: '<b>Partial</b> answer', parse_mode: 'HTML' },
      { chat_id: ada.id, draft_id: '7', text: ' \n ' },
      {
        chat_id: ada.id,
        draft_id: '-9223372036854775808',
        text: 'Second try',
        entities: [{ type: 'italic', offset: 0, length: 6 }],
      },
      { chat_id: ada.id, draft_id: 8, text: 'x'.repeat(MAX_TEXT_LENGTH) },
    ];
    for (const write of writes) {
      expectEqual(
        await callBot('sendMessageDraft', write),
        { status: 200, body: { ok: true, result: true } },
        `Expected the draft ${JSON.stringify(write)} to be shown`,
      );
      drafts.push(await ada.getMessageDraft({ chat: privateChat }));
    }
    expectEqual(
      drafts.slice(0, -1),
      [
        null,
        { draft_id: '7', text: '' },
        {
          draft_id: '7',
          text: 'Partial answer',
          entities: [{ type: 'bold', offset: 0, length: 7 }],
        },
        { draft_id: '7', text: '' },
        {
          draft_id: '-9223372036854775808',
          text: 'Second try',
          entities: [{ type: 'italic', offset: 0, length: 6 }],
        },
      ],
      'Expected each write to change or replace the draft, with blank text thinking',
    );
    expectEqual(
      [drafts.at(-1)?.draft_id, drafts.at(-1)?.text.length],
      ['8', MAX_TEXT_LENGTH],
      'Expected a draft as long as a message to be shown',
    );
    await callBot('sendMessageDraft', {
      chat_id: ada.id,
      draft_id: 9,
      text: 'Ada, one moment',
      entities: [{ type: 'text_mention', offset: 0, length: 3, user: { id: ada.id } }],
    });
    expectEqual(
      await ada.getMessageDraft({ chat: privateChat }),
      {
        draft_id: '9',
        text: 'Ada, one moment',
        entities: [{
          type: 'text_mention',
          offset: 0,
          length: 3,
          user: { id: ada.id, is_bot: false, first_name: 'Ada' },
        }],
      },
      'Expected a mention in the draft to show the mentioned user',
    );
    expectEqual(
      await ada.getMessages({ chat: privateChat }),
      historyBefore,
      'Expected drafts to leave the chat history unchanged',
    );

    const answer = await callBot('sendMessage', { chat_id: ada.id, text: 'Final answer' });
    const historyAfter = await ada.getMessages({ chat: privateChat });
    expectEqual(
      [
        answer.status,
        await ada.getMessageDraft({ chat: privateChat }),
        historyAfter.length - historyBefore.length,
        historyAfter.at(-1)?.text,
        historyAfter.at(-1)?.from.id,
      ],
      [200, null, 1, 'Final answer', bot.id],
      'Expected the final message to replace the draft in the history',
    );
  } finally {
    await session.end();
  }
});

Deno.test('sendMessageDraft refuses what Telegram refuses and leaves the chat as it was', async () => {
  const { session, bot, ada, privateChat, callBot } = await createDraftFixture();
  try {
    const { account: grace } = await session.createAccount({ first_name: 'Grace' });
    const memberSupergroup = await ada.createSupergroup({ title: 'Study group' });
    await ada.addChatMember({
      chat: { type: 'supergroup', chatId: memberSupergroup.id },
      userId: bot.id,
    });
    const otherSupergroup = await ada.createSupergroup({ title: 'Book club' });
    await callBot('sendMessageDraft', { chat_id: ada.id, draft_id: 1, text: 'Kept' });
    const historyBefore = await ada.getMessages({ chat: privateChat });
    const pendingUpdatesBefore = await countPendingUpdates(callBot);

    const invalidParameters = 'Bad Request: invalid sendMessageDraft parameters';
    const unsupportedStop = 'Bad Request: can_stop and keep_on_stop are not supported';
    const cases: readonly (readonly [Record<string, unknown>, number, string])[] = [
      [{ chat_id: ada.id, draft_id: 0, text: 'x' }, 400, 'Bad Request: RANDOM_ID_INVALID'],
      [{ chat_id: ada.id, text: 'x' }, 400, 'Bad Request: RANDOM_ID_INVALID'],
      [{ chat_id: ada.id, draft_id: 'next', text: 'x' }, 400, invalidParameters],
      [{ chat_id: ada.id, draft_id: '9223372036854775808' }, 400, invalidParameters],
      [{ chat_id: ada.id, draft_id: 2, message_thread_id: 3 }, 400, invalidParameters],
      [{ chat_id: ada.id, draft_id: 2, can_stop: true }, 400, unsupportedStop],
      [{ chat_id: ada.id, draft_id: 2, keep_on_stop: true }, 400, unsupportedStop],
      [{ draft_id: 2, text: 'x' }, 400, 'Bad Request: chat_id is empty'],
      [{ chat_id: 999, draft_id: 2, text: 'x' }, 400, 'Bad Request: chat not found'],
      [{ chat_id: grace.id, draft_id: 2, text: 'x' }, 400, 'Bad Request: chat not found'],
      [{ chat_id: otherSupergroup.id, draft_id: 2 }, 400, 'Bad Request: chat not found'],
      [
        { chat_id: memberSupergroup.id, draft_id: 2, text: 'x' },
        400,
        'Bad Request: TEXTDRAFT_PEER_INVALID',
      ],
      [
        { chat_id: ada.id, draft_id: 2, text: 'x'.repeat(MAX_TEXT_LENGTH + 1) },
        400,
        'Bad Request: message is too long',
      ],
      [
        { chat_id: ada.id, draft_id: 2, text: '<b>x', parse_mode: 'HTML' },
        400,
        'Bad Request: can\'t parse entities: Can\'t find end tag corresponding to start tag "b"',
      ],
      [
        { chat_id: ada.id, draft_id: 2, text: 'x', parse_mode: 'Markdown3' },
        400,
        'Bad Request: unsupported parse_mode',
      ],
      [
        {
          chat_id: ada.id,
          draft_id: 2,
          text: 'x',
          entities: [{ type: 'text_mention', offset: 0, length: 1, user: { id: 999 } }],
        },
        400,
        'Bad Request: user not found',
      ],
      // Telegram reads the text's markup before the chat, finds the chat before TDLib
      // normalizes the text, and leaves the draft ID to its servers, which refuse a chat that is
      // not private first.
      [
        { chat_id: 999, draft_id: 2, text: '<b>x', parse_mode: 'HTML' },
        400,
        'Bad Request: can\'t parse entities: Can\'t find end tag corresponding to start tag "b"',
      ],
      [{ chat_id: 999, draft_id: 0, text: 'x' }, 400, 'Bad Request: chat not found'],
      [
        {
          chat_id: 999,
          draft_id: 2,
          text: 'x',
          entities: [{ type: 'text_mention', offset: 0, length: 1, user: { id: 999 } }],
        },
        400,
        'Bad Request: chat not found',
      ],
      [{ chat_id: memberSupergroup.id, draft_id: 0 }, 400, 'Bad Request: TEXTDRAFT_PEER_INVALID'],
    ];
    for (const [parameters, status, description] of cases) {
      expectEqual(
        await callBot('sendMessageDraft', parameters),
        { status, body: { ok: false, error_code: status, description } },
        `Expected ${JSON.stringify(parameters)} to be refused`,
      );
    }

    expectEqual(
      await countPendingUpdates(callBot),
      pendingUpdatesBefore,
      'Expected refused drafts to send the bot no updates',
    );

    await ada.blockBot({ botId: bot.id });
    for (const draftId of [2, 0]) {
      expectEqual(
        await callBot('sendMessageDraft', { chat_id: ada.id, draft_id: draftId, text: 'x' }),
        {
          status: 403,
          body: {
            ok: false,
            error_code: 403,
            description: 'Forbidden: bot was blocked by the user',
          },
        },
        `Expected the blocked bot's draft ${draftId} to be refused`,
      );
    }
    await ada.unblockBot({ botId: bot.id });

    expectEqual(
      [
        await ada.getMessageDraft({ chat: privateChat }),
        await grace.getMessageDraft({ chat: privateChat }),
        await ada.getMessages({ chat: privateChat }),
      ],
      [{ draft_id: '1', text: 'Kept' }, null, historyBefore],
      'Expected refused drafts to change neither the draft nor the history',
    );
  } finally {
    await session.end();
  }
});

Deno.test('a test expires the draft an account sees, which the bot can show again', async () => {
  const { api, session, ada, privateChat, callBot } = await createDraftFixture();
  try {
    const expiryOutcome = async (draftId?: string) => {
      try {
        await ada.expireMessageDraft({
          chat: privateChat,
          ...(draftId === undefined ? {} : { draft_id: draftId }),
        });
        return 'expired';
      } catch (error) {
        if (error instanceof EmulationClientError) {
          return error.status;
        }
        throw error;
      }
    };
    const shownDraft = () => ada.getMessageDraft({ chat: privateChat });
    const pendingUpdatesBefore = await countPendingUpdates(callBot);

    const withoutDraft = await expiryOutcome();
    await callBot('sendMessageDraft', { chat_id: ada.id, draft_id: 5, text: 'Partial' });
    const mismatch = await expiryOutcome('6');
    const afterMismatch = await shownDraft();
    const matching = await expiryOutcome('5');
    const afterExpiry = await shownDraft();
    const repeated = await expiryOutcome('5');
    await callBot('sendMessageDraft', { chat_id: ada.id, draft_id: 5, text: 'Partial again' });
    const sameIdAgain = await shownDraft();
    await callBot('sendMessageDraft', { chat_id: ada.id, draft_id: 6, text: 'New draft' });
    const otherId = await shownDraft();
    const unguarded = await expiryOutcome();

    expectEqual(
      [
        withoutDraft,
        mismatch,
        afterMismatch,
        matching,
        afterExpiry,
        repeated,
        sameIdAgain,
        otherId,
        unguarded,
        await shownDraft(),
        await countPendingUpdates(callBot),
      ],
      [
        404,
        409,
        { draft_id: '5', text: 'Partial' },
        'expired',
        null,
        404,
        { draft_id: '5', text: 'Partial again' },
        { draft_id: '6', text: 'New draft' },
        'expired',
        null,
        pendingUpdatesBefore,
      ],
      'Expected expiry to remove only the expected draft, without telling the bot',
    );

    await callBot('sendMessageDraft', { chat_id: ada.id, draft_id: 5, text: 'Partial' });
    const expirationPath =
      `/sessions/${session.id}/accounts/${ada.id}/conversations/private/${privateChat.botId}` +
      '/message-draft/expiration';
    const rawExpiryStatus = async (body: string) =>
      (await api.request(expirationPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })).status;
    expectEqual(
      [
        await rawExpiryStatus(JSON.stringify({ draft_id: 5 })),
        await rawExpiryStatus(JSON.stringify({ draft_id: '05' })),
        await rawExpiryStatus(JSON.stringify({ draft_id: '0' })),
        await rawExpiryStatus(JSON.stringify({ draft_id: '5', reason: 'timeout' })),
        await rawExpiryStatus('not JSON'),
        await shownDraft(),
        await rawExpiryStatus(''),
        await shownDraft(),
      ],
      [400, 400, 400, 400, 400, { draft_id: '5', text: 'Partial' }, 204, null],
      'Expected malformed expiries to be rejected and an empty body to expire any draft',
    );
  } finally {
    await session.end();
  }
});

Deno.test('drafts stay within their own chat, bot and session', async () => {
  const api = createTestApi();
  const { session, bot, ada, privateChat, callBot } = await createDraftFixture(api);
  const other = await createDraftFixture(api);
  try {
    const { account: grace } = await session.createAccount({ first_name: 'Grace' });
    await grace.sendMessage({ to: privateChat, text: '/start' });
    const { bot: otherBot, token: otherBotToken } = await session.createBot({
      first_name: 'Other Bot',
      username: 'other_bot',
    });
    const otherBotChat: PrivateMessageTarget = { type: 'private', botId: otherBot.id };
    await ada.sendMessage({ to: otherBotChat, text: '/start' });

    await callBot('sendMessageDraft', { chat_id: ada.id, draft_id: 1, text: 'For Ada' });
    await callBotWith(api, session, otherBotToken)('sendMessageDraft', {
      chat_id: ada.id,
      draft_id: 1,
      text: 'From the other bot',
    });
    let graceExpiry: unknown;
    try {
      await grace.expireMessageDraft({ chat: privateChat });
    } catch (error) {
      graceExpiry = error instanceof EmulationClientError ? error.status : error;
    }

    expectEqual(
      [
        await ada.getMessageDraft({ chat: privateChat }),
        await ada.getMessageDraft({ chat: otherBotChat }),
        await grace.getMessageDraft({ chat: privateChat }),
        graceExpiry,
        await other.ada.getMessageDraft({ chat: other.privateChat }),
        [other.ada.id, other.bot.id],
      ],
      [
        { draft_id: '1', text: 'For Ada' },
        { draft_id: '1', text: 'From the other bot' },
        null,
        404,
        null,
        [ada.id, bot.id],
      ],
      "Expected each draft to show only in its bot's chat with its account, in its session",
    );
  } finally {
    await session.end();
    await other.session.end();
  }
});

Deno.test("only the bot's messages that reach the chat remove its draft", async () => {
  const { api, session, bot, ada, privateChat, callBot } = await createDraftFixture();
  try {
    const { account: grace } = await session.createAccount({ first_name: 'Grace' });
    await grace.sendMessage({ to: privateChat, text: '/start' });
    const supergroup = await ada.createSupergroup({ title: 'Study group' });
    await ada.addChatMember({
      chat: { type: 'supergroup', chatId: supergroup.id },
      userId: bot.id,
    });
    const adaMessage = await ada.sendMessage({ to: privateChat, text: 'Question' });
    await callBot('sendMessageDraft', { chat_id: ada.id, draft_id: 1, text: 'Thinking' });

    const keptAfter = async (action: () => Promise<unknown>) => {
      await action();
      return await ada.getMessageDraft({ chat: privateChat });
    };
    const kept = { draft_id: '1', text: 'Thinking' };
    expectEqual(
      [
        await keptAfter(() => ada.sendMessage({ to: privateChat, text: 'Still there?' })),
        await keptAfter(() => callBot('sendChatAction', { chat_id: ada.id, action: 'typing' })),
        await ada.getChatActions({ chat: privateChat }),
        await keptAfter(() => callBot('sendChatAction', { chat_id: ada.id, action: 'cancel' })),
        await keptAfter(() =>
          callBot('sendMessage', {
            chat_id: ada.id,
            text: 'Reply',
            reply_parameters: { message_id: 999 },
          })
        ),
        await keptAfter(() => callBot('sendMessage', { chat_id: grace.id, text: 'Hi Grace' })),
        await keptAfter(() => callBot('sendMessage', { chat_id: supergroup.id, text: 'Hi all' })),
      ],
      [kept, kept, [{ bot_id: bot.id, action: 'typing' }], kept, kept, kept, kept],
      'Expected messages and actions that do not reach the chat from the bot to keep its draft',
    );

    const clearedBy = async (method: string, parameters: Record<string, unknown>) => {
      await callBot('sendMessageDraft', { chat_id: ada.id, draft_id: 1, text: 'Thinking' });
      const { status } = await callBot(method, parameters);
      return [status, await ada.getMessageDraft({ chat: privateChat })];
    };
    const photoAlbum = new FormData();
    photoAlbum.set('chat_id', String(ada.id));
    photoAlbum.set(
      'media',
      JSON.stringify([
        { type: 'photo', media: 'attach://first' },
        { type: 'photo', media: 'attach://second' },
      ]),
    );
    photoAlbum.set('first', new File([tinyGif()], 'first.gif', { type: 'image/gif' }));
    photoAlbum.set('second', new File([tinyGif()], 'second.gif', { type: 'image/gif' }));
    expectEqual(
      [
        await clearedBy('forwardMessage', {
          chat_id: ada.id,
          from_chat_id: ada.id,
          message_id: adaMessage.message_id,
        }),
        await clearedBy('copyMessage', {
          chat_id: ada.id,
          from_chat_id: ada.id,
          message_id: adaMessage.message_id,
        }),
        await (async () => {
          await callBot('sendMessageDraft', { chat_id: ada.id, draft_id: 1, text: 'Thinking' });
          const { status } = await fetchBot(api, session, bot.token, 'sendMediaGroup', photoAlbum);
          return [status, await ada.getMessageDraft({ chat: privateChat })];
        })(),
      ],
      [[200, null], [200, null], [200, null]],
      "Expected forwards, copies and albums in the chat to remove the bot's draft",
    );
  } finally {
    await session.end();
  }
});

Deno.test('a grammY bot streams a draft the account watches until the answer arrives', async () => {
  const { session, fetch, bot, ada, privateChat } = await createDraftFixture();
  const grammyBot = new Bot(bot.token, { client: { apiRoot: session.botApiRoot, fetch } });
  const nextChunk = Promise.withResolvers<void>();
  const answerReady = Promise.withResolvers<void>();
  grammyBot.command('ask', async (context) => {
    // As grammY's `replyWithDraft` does, the update that asked names the draft.
    const draftId = context.update.update_id;
    await context.api.sendMessageDraft(context.chat.id, draftId, '');
    await nextChunk.promise;
    await context.api.sendMessageDraft(context.chat.id, draftId, 'The answer is', {
      entities: [{ type: 'bold', offset: 4, length: 6 }],
    });
    await answerReady.promise;
    await context.reply('The answer is 42');
  });
  const activity = session.botActivity({ bot_id: bot.id });
  const start = await activity.position();
  const runner = run(grammyBot);

  try {
    await ada.sendMessage({ to: privateChat, text: '/ask' });
    const thinking = await activity.waitFor({
      method: 'sendMessageDraft',
      chat_id: ada.id,
      ok: true,
      parameters: { text: '' },
    }, { after: start });
    const draftId = String(thinking.parameters.draft_id);
    const thinkingDraft = await ada.getMessageDraft({ chat: privateChat });

    nextChunk.resolve();
    await activity.waitFor({
      method: 'sendMessageDraft',
      chat_id: ada.id,
      ok: true,
      parameters: { text: 'The answer is' },
    }, { after: thinking });
    const partialDraft = await ada.getMessageDraft({ chat: privateChat });

    answerReady.resolve();
    await activity.waitFor({
      method: 'sendMessage',
      chat_id: ada.id,
      ok: true,
      parameters: { text: 'The answer is 42' },
    }, { after: thinking });

    expectEqual(
      [
        thinkingDraft,
        partialDraft,
        await ada.getMessageDraft({ chat: privateChat }),
        (await ada.getMessages({ chat: privateChat })).map(({ text }) => text),
      ],
      [
        { draft_id: draftId, text: '' },
        {
          draft_id: draftId,
          text: 'The answer is',
          entities: [{ type: 'bold', offset: 4, length: 6 }],
        },
        null,
        ['/start', '/ask', 'The answer is 42'],
      ],
      'Expected the account to watch the draft grow until the answer replaced it',
    );
  } finally {
    nextChunk.resolve();
    answerReady.resolve();
    await runner.stop();
    await session.end();
  }
});

Deno.test('the TypeScript client decodes message drafts strictly', () => {
  const decoded = [
    { message_draft: null },
    { message_draft: { draft_id: '-5', text: '' } },
    { message_draft: { draft_id: 5, text: '' } },
    { message_draft: { draft_id: '0', text: '' } },
    { message_draft: { draft_id: '5', text: 'x', entities: [] } },
    { message_draft: { draft_id: '5', text: 'x', can_stop: false } },
  ].map((body) => messageDraftResponseSchema.safeParse(body).success);
  expectEqual(
    decoded,
    [true, true, false, false, false, false],
    'Expected only drafts the emulator writes to decode',
  );
});

interface BotApiCallResult {
  readonly status: number;
  readonly body: unknown;
}

type BotApiCaller = (
  method: string,
  parameters: Record<string, unknown>,
) => Promise<BotApiCallResult>;

interface DraftFixture {
  readonly api: EmulationApi;
  readonly session: EmulationSessionClient;
  readonly fetch: typeof globalThis.fetch;
  readonly bot: { readonly id: number; readonly token: string };
  readonly ada: VirtualAccountClient;
  readonly privateChat: PrivateMessageTarget;
  readonly callBot: BotApiCaller;
}

/** A session in which Ada started a chat with the bot, which answers Bot API calls. */
async function createDraftFixture(api = createTestApi()): Promise<DraftFixture> {
  const fetch: typeof globalThis.fetch = async (input, init) =>
    await api.fetch(new Request(input, init));
  const session = await new TelegramEmulationClient(TEST_PUBLIC_ORIGIN, { fetch }).createSession();
  const createdBot = await session.createBot({ first_name: 'Answer Bot', username: 'answer_bot' });
  const { account: ada } = await session.createAccount({ first_name: 'Ada' });
  const privateChat: PrivateMessageTarget = { type: 'private', botId: createdBot.bot.id };
  await ada.sendMessage({ to: privateChat, text: '/start' });
  return {
    api,
    session,
    fetch,
    bot: { id: createdBot.bot.id, token: createdBot.token },
    ada,
    privateChat,
    callBot: callBotWith(api, session, createdBot.token),
  };
}

function callBotWith(
  api: EmulationApi,
  session: EmulationSessionClient,
  token: string,
): BotApiCaller {
  return (method, parameters) => fetchBot(api, session, token, method, JSON.stringify(parameters));
}

async function fetchBot(
  api: EmulationApi,
  session: EmulationSessionClient,
  token: string,
  method: string,
  body: string | FormData,
): Promise<BotApiCallResult> {
  const response = await api.request(`/sessions/${session.id}/bot-api/bot${token}/${method}`, {
    method: 'POST',
    ...(typeof body === 'string' ? { headers: { 'Content-Type': 'application/json' } } : {}),
    body,
  });
  return { status: response.status, body: await response.json() };
}

/** How many updates wait for the bot, read without confirming any. */
async function countPendingUpdates(callBot: BotApiCaller): Promise<number> {
  const { body } = await callBot('getUpdates', { timeout: 0 });
  return (body as { result: unknown[] }).result.length;
}

/** A 4 by 3 GIF image, whose header is all the emulator reads. */
function tinyGif(): Uint8Array<ArrayBuffer> {
  const content = new Uint8Array(13);
  content.set(new TextEncoder().encode('GIF89a'));
  content.set([4, 0, 3, 0], 6);
  return content;
}

function expectEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}
