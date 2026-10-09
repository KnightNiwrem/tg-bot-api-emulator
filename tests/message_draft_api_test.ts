import { Bot } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/bot.ts';
import { webhookCallback } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/convenience/webhook.ts';
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
  const { api, session, bot, ada, privateChat, callBot } = await createDraftFixture();
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
        shownDraft('7', ''),
        shownDraft('7', 'Partial answer', {
          entities: [{ type: 'bold', offset: 0, length: 7 }],
        }),
        shownDraft('7', ''),
        shownDraft('-9223372036854775808', 'Second try', {
          entities: [{ type: 'italic', offset: 0, length: 6 }],
        }),
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
      shownDraft('9', 'Ada, one moment', {
        entities: [{
          type: 'text_mention',
          offset: 0,
          length: 3,
          user: { id: ada.id, is_bot: false, first_name: 'Ada' },
        }],
      }),
      'Expected a mention in the draft to show the mentioned user',
    );
    // A JSON number beyond JavaScript's safe integers keeps every digit, as Telegram reads it.
    await fetchBot(
      api,
      session,
      bot.token,
      'sendMessageDraft',
      `{"chat_id": ${ada.id}, "draft_id": 9007199254740993}`,
    );
    expectEqual(
      (await ada.getMessageDraft({ chat: privateChat }))?.draft_id,
      '9007199254740993',
      'Expected a 64-bit draft ID sent as a JSON number to stay exact',
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
    const cases: readonly (readonly [Record<string, unknown>, number, string])[] = [
      [{ chat_id: ada.id, draft_id: 0, text: 'x' }, 400, 'Bad Request: RANDOM_ID_INVALID'],
      [{ chat_id: ada.id, text: 'x' }, 400, 'Bad Request: RANDOM_ID_INVALID'],
      [{ chat_id: ada.id, draft_id: 'next', text: 'x' }, 400, invalidParameters],
      [{ chat_id: ada.id, draft_id: '9223372036854775808' }, 400, invalidParameters],
      [{ chat_id: ada.id, draft_id: 2, message_thread_id: 3 }, 400, invalidParameters],
      [{ chat_id: ada.id, draft_id: 2, can_stop: 'maybe' }, 400, invalidParameters],
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
      [shownDraft('1', 'Kept'), null, historyBefore],
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
    const readDraft = () => ada.getMessageDraft({ chat: privateChat });
    const pendingUpdatesBefore = await countPendingUpdates(callBot);

    const withoutDraft = await expiryOutcome();
    await callBot('sendMessageDraft', { chat_id: ada.id, draft_id: 5, text: 'Partial' });
    const mismatch = await expiryOutcome('6');
    const afterMismatch = await readDraft();
    const matching = await expiryOutcome('5');
    const afterExpiry = await readDraft();
    const repeated = await expiryOutcome('5');
    await callBot('sendMessageDraft', { chat_id: ada.id, draft_id: 5, text: 'Partial again' });
    const sameIdAgain = await readDraft();
    await callBot('sendMessageDraft', { chat_id: ada.id, draft_id: 6, text: 'New draft' });
    const otherId = await readDraft();
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
        await readDraft(),
        await countPendingUpdates(callBot),
      ],
      [
        404,
        409,
        shownDraft('5', 'Partial'),
        'expired',
        null,
        404,
        shownDraft('5', 'Partial again'),
        shownDraft('6', 'New draft'),
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
        await rawExpiryStatus(JSON.stringify({ draft_id: 'abc' })),
        await rawExpiryStatus(JSON.stringify({ draft_id: '9223372036854775808' })),
        await rawExpiryStatus(JSON.stringify({ draft_id: '5', reason: 'timeout' })),
        await rawExpiryStatus('not JSON'),
        await readDraft(),
        await rawExpiryStatus(''),
        await readDraft(),
      ],
      [400, 400, 400, 400, 400, 400, 400, shownDraft('5', 'Partial'), 204, null],
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
        shownDraft('1', 'For Ada'),
        shownDraft('1', 'From the other bot'),
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
    const followUp = await ada.sendMessage({ to: privateChat, text: 'Follow-up' });
    await callBot('sendMessageDraft', { chat_id: ada.id, draft_id: 1, text: 'Thinking' });

    const keptAfter = async (action: () => Promise<unknown>) => {
      await action();
      return await ada.getMessageDraft({ chat: privateChat });
    };
    const kept = shownDraft('1', 'Thinking');
    expectEqual(
      [
        await keptAfter(() => ada.sendMessage({ to: privateChat, text: 'Still there?' })),
        await keptAfter(() =>
          ada.pinMessage({ chat: privateChat, message_id: adaMessage.message_id })
        ),
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
      [kept, kept, kept, [{ bot_id: bot.id, action: 'typing' }], kept, kept, kept, kept],
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
        // The pin's service message is the bot's, which reaches the chat as any message does.
        await clearedBy('pinChatMessage', { chat_id: ada.id, message_id: followUp.message_id }),
        await (async () => {
          await callBot('sendMessageDraft', { chat_id: ada.id, draft_id: 1, text: 'Thinking' });
          const { status } = await fetchBot(api, session, bot.token, 'sendMediaGroup', photoAlbum);
          return [status, await ada.getMessageDraft({ chat: privateChat })];
        })(),
      ],
      [[200, null], [200, null], [200, null], [200, null]],
      "Expected forwards, copies, albums and pins in the chat to remove the bot's draft",
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
        shownDraft(draftId, ''),
        shownDraft(draftId, 'The answer is', {
          entities: [{ type: 'bold', offset: 4, length: 6 }],
        }),
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

Deno.test('an account stops a draft and its bot alone receives the stop', async () => {
  const { api, session, bot, ada, privateChat, callBot } = await createDraftFixture();
  try {
    const { account: grace } = await session.createAccount({ first_name: 'Grace' });
    await grace.sendMessage({ to: privateChat, text: '/start' });
    const { bot: otherBot, token: otherBotToken } = await session.createBot({
      first_name: 'Other Bot',
      username: 'other_bot',
    });
    await ada.sendMessage({ to: { type: 'private', botId: otherBot.id }, text: '/start' });
    const activity = session.botActivity({ bot_id: bot.id });
    const historyBefore = await ada.getMessages({ chat: privateChat });
    // Beyond the integers JavaScript holds exactly, which only the decimal text form keeps.
    const draftId = '9007199254740993';
    await callBot('sendMessageDraft', {
      chat_id: ada.id,
      draft_id: draftId,
      text: 'Partial',
      can_stop: true,
    });
    await callBot('sendMessageDraft', { chat_id: grace.id, draft_id: 1, can_stop: true });
    const shownBeforeStop = await ada.getMessageDraft({ chat: privateChat });
    const beforeStop = await activity.position();

    await ada.stopMessageDraft({ chat: privateChat, draft_id: draftId });
    const stops = await pendingStops(callBot);
    const delivery = await activity.waitFor({
      kind: 'update_delivered',
      where: (entry) => 'stopped_message_generation' in entry.update,
    }, { after: beforeStop });

    expectEqual(
      [
        shownBeforeStop,
        await ada.getMessageDraft({ chat: privateChat }),
        await grace.getMessageDraft({ chat: privateChat }),
        stops,
        await pendingStops(callBotWith(api, session, otherBotToken)),
        [delivery.chat_id, 'user_id' in delivery, delivery.via],
        Object.keys(delivery.update).sort(),
        await ada.getMessages({ chat: privateChat }),
      ],
      [
        shownDraft(draftId, 'Partial', { can_stop: true }),
        null,
        shownDraft('1', '', { can_stop: true }),
        [{ chat: { id: ada.id, type: 'private', first_name: 'Ada' }, draft_id: draftId }],
        [],
        [ada.id, false, 'polling'],
        ['stopped_message_generation', 'update_id'],
        historyBefore,
      ],
      "Expected only Ada's draft to stop, telling only its bot the chat and the draft ID as text",
    );
  } finally {
    await session.end();
  }
});

Deno.test('a kept draft stays stopped until it expires or the bot sends the partial answer', async () => {
  const { session, ada, privateChat, callBot } = await createDraftFixture();
  try {
    const stopOutcome = () => draftActionOutcome(ada.stopMessageDraft({ chat: privateChat }));
    const readDraft = () => ada.getMessageDraft({ chat: privateChat });
    const writeKeptDraft = (draftId: number, text: string) =>
      callBot('sendMessageDraft', {
        chat_id: ada.id,
        draft_id: draftId,
        text,
        can_stop: true,
        keep_on_stop: true,
      });
    const kept = { can_stop: true, keep_on_stop: true } as const;
    const historyBefore = await ada.getMessages({ chat: privateChat });

    await writeKeptDraft(5, 'Partial');
    const firstStop = await stopOutcome();
    const afterFirstStop = await readDraft();
    const repeatedStop = await stopOutcome();
    await ada.expireMessageDraft({ chat: privateChat, draft_id: '5' });
    const afterExpiry = await readDraft();
    await writeKeptDraft(5, 'Late output');
    const lateDraft = await readDraft();
    const lateStop = await stopOutcome();
    await writeKeptDraft(6, 'Partial answer');
    const thirdStop = await stopOutcome();
    const savedAnswer = await callBot('sendMessage', { chat_id: ada.id, text: 'Partial answer' });
    const historyAfter = await ada.getMessages({ chat: privateChat });

    expectEqual(
      [
        firstStop,
        afterFirstStop,
        repeatedStop,
        afterExpiry,
        lateDraft,
        lateStop,
        thirdStop,
        savedAnswer.status,
        await readDraft(),
        historyAfter.slice(historyBefore.length).map(({ text }) => text),
        (await pendingStops(callBot)).map(({ draft_id }) => draft_id),
      ],
      [
        'done',
        shownDraft('5', 'Partial', { ...kept, is_stopped: true }),
        409,
        null,
        shownDraft('5', 'Late output', kept),
        'done',
        'done',
        200,
        null,
        ['Partial answer'],
        ['5', '5', '6'],
      ],
      'Expected each stop of a shown Stop button to reach the bot once, and kept drafts to end',
    );
  } finally {
    await session.end();
  }
});

Deno.test('refused stops leave the draft shown and tell the bot nothing', async () => {
  const api = createTestApi();
  const { session, bot, ada, privateChat, callBot } = await createDraftFixture(api);
  const other = await createDraftFixture(api);
  try {
    const { account: grace } = await session.createAccount({ first_name: 'Grace' });
    await grace.sendMessage({ to: privateChat, text: '/start' });
    const { bot: otherBot } = await session.createBot({
      first_name: 'Other Bot',
      username: 'other_bot',
    });
    const stop = (account: VirtualAccountClient, botId: number, draft_id?: string) =>
      draftActionOutcome(account.stopMessageDraft({
        chat: { type: 'private', botId },
        ...(draft_id === undefined ? {} : { draft_id }),
      }));

    const withoutDraft = await stop(ada, bot.id);
    await callBot('sendMessageDraft', {
      chat_id: ada.id,
      draft_id: 3,
      text: 'No button',
      keep_on_stop: true,
    });
    const withoutButton = await stop(ada, bot.id);
    await callBot('sendMessageDraft', { chat_id: ada.id, draft_id: 4, can_stop: true });
    const outcomes = [
      withoutDraft,
      withoutButton,
      await stop(ada, bot.id, '3'),
      await stop(grace, bot.id),
      await stop(ada, otherBot.id),
      await stop(ada, 999),
      await stop(other.ada, other.bot.id),
    ];
    const stopPath = `/sessions/${session.id}/accounts/${ada.id}/conversations/private/${bot.id}` +
      '/message-draft/stop';
    for (
      const body of [JSON.stringify({ draft_id: 4 }), JSON.stringify({ draft_id: '04' }), '[]']
    ) {
      outcomes.push(
        (await api.request(stopPath, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        })).status,
      );
    }

    expectEqual(
      [
        outcomes,
        await ada.getMessageDraft({ chat: privateChat }),
        await pendingStops(callBot),
      ],
      [
        [404, 403, 409, 404, 404, 404, 404, 400, 400, 400],
        shownDraft('4', '', { can_stop: true }),
        [],
      ],
      'Expected refused stops to keep the draft and send no update',
    );
  } finally {
    await session.end();
    await other.session.end();
  }
});

Deno.test('a bot receives stops only while it subscribes to them', async () => {
  const { session, ada, privateChat, callBot } = await createDraftFixture();
  try {
    const stopNewDraft = async (draftId: number) => {
      await callBot('sendMessageDraft', { chat_id: ada.id, draft_id: draftId, can_stop: true });
      await ada.stopMessageDraft({ chat: privateChat });
    };
    const subscribe = (allowedUpdates: readonly string[]) =>
      callBot('getUpdates', { timeout: 0, allowed_updates: allowedUpdates });

    await stopNewDraft(1);
    await subscribe(['message']);
    await stopNewDraft(2);
    await subscribe(['STOPPED_MESSAGE_GENERATION']);
    await stopNewDraft(3);

    expectEqual(
      (await pendingStops(callBot)).map(({ draft_id }) => draft_id),
      ['1', '3'],
      'Expected the default subscription and an explicit one, but not others, to receive stops',
    );
  } finally {
    await session.end();
  }
});

Deno.test('a grammY bot receives a stop through its webhook', async () => {
  const { api, session, fetch, bot, ada, privateChat } = await createDraftFixture();
  const grammyBot = new Bot(bot.token, { client: { apiRoot: session.botApiRoot, fetch } });
  const received = Promise.withResolvers<readonly unknown[]>();
  grammyBot.on('stopped_message_generation', (context) => {
    const { draft_id } = context.update.stopped_message_generation;
    received.resolve([context.chat.id, context.from, typeof draft_id, draft_id]);
  });
  const handleWebhookRequest = webhookCallback(grammyBot, 'std/http');
  const webhookServer = Deno.serve(
    { hostname: '127.0.0.1', port: 0, onListen: () => {} },
    (request) => handleWebhookRequest(request),
  );
  const activity = session.botActivity({ bot_id: bot.id });

  try {
    await grammyBot.api.setWebhook(`http://127.0.0.1:${webhookServer.addr.port}/webhook`);
    await grammyBot.api.sendMessageDraft(ada.id, 42, 'Partial', { can_stop: true });
    const beforeStop = await activity.position();
    await ada.stopMessageDraft({ chat: privateChat, draft_id: '42' });

    expectEqual(
      await received.promise,
      [ada.id, undefined, 'string', '42'],
      "Expected grammY's handler to see the chat, no user, and the draft ID as text",
    );
    await activity.waitFor({
      kind: 'update_delivered',
      chat_id: ada.id,
      where: (entry) => entry.via === 'webhook' && 'stopped_message_generation' in entry.update,
    }, { after: beforeStop });
  } finally {
    await api.request(`/sessions/${session.id}`, { method: 'DELETE' });
    await webhookServer.shutdown();
  }
});

// Follows "Stopping a streamed answer" in docs/clients/typescript/messages.md, with grammY's runner
// in place of the guide's fixture.
Deno.test('a grammY bot aborts its generator when the account stops its draft', async () => {
  const { session, fetch, bot, ada, privateChat } = await createDraftFixture();
  const grammyBot = new Bot(bot.token, { client: { apiRoot: session.botApiRoot, fetch } });
  const chunks = ['The', ' answer', ' is', ' 42'];
  // The test releases each chunk, so the generator never runs ahead of what it observed.
  const chunkReleases = chunks.map(() => Promise.withResolvers<void>());
  const generations = new Map<string, AbortController>();
  const botErrors: unknown[] = [];
  let generatorStopReason: unknown;

  async function* generateAnswer(signal: AbortSignal): AsyncGenerator<string> {
    for (const [index, chunk] of chunks.entries()) {
      await Promise.race([chunkReleases[index]?.promise, abortion(signal)]);
      if (signal.aborted) {
        generatorStopReason = signal.reason;
        return;
      }
      yield chunk;
    }
  }
  grammyBot.command('ask', (context) => {
    const draftId = context.update.update_id;
    const generation = new AbortController();
    generations.set(String(draftId), generation);
    // Streams in the background, so the bot keeps reading updates, the stop among them.
    void (async () => {
      let answer = '';
      for await (const chunk of generateAnswer(generation.signal)) {
        answer += chunk;
        await context.api.sendMessageDraft(context.chat.id, draftId, answer, { can_stop: true });
      }
      await context.reply(generation.signal.aborted ? `${answer} (stopped)` : answer);
    })().catch((error: unknown) => botErrors.push(error));
  });
  grammyBot.on('stopped_message_generation', (context) => {
    const { draft_id } = context.update.stopped_message_generation;
    generations.get(String(draft_id))?.abort('stopped by the user');
  });
  const activity = session.botActivity({ bot_id: bot.id });
  const start = await activity.position();
  const runner = run(grammyBot);

  try {
    await ada.sendMessage({ to: privateChat, text: '/ask' });
    chunkReleases[0]?.resolve();
    const firstChunk = await activity.waitFor({
      method: 'sendMessageDraft',
      chat_id: ada.id,
      ok: true,
      parameters: { text: 'The' },
    }, { after: start });
    chunkReleases[1]?.resolve();
    await activity.waitFor({
      method: 'sendMessageDraft',
      chat_id: ada.id,
      ok: true,
      parameters: { text: 'The answer' },
    }, { after: firstChunk });
    const draftId = String(firstChunk.parameters.draft_id);
    const streamedDraft = await ada.getMessageDraft({ chat: privateChat });

    const beforeStop = await activity.position();
    await ada.stopMessageDraft({ chat: privateChat, draft_id: draftId });
    const savedAnswer = await activity.waitFor({
      method: 'sendMessage',
      chat_id: ada.id,
      ok: true,
    }, { after: beforeStop });
    await activity.assertNone(
      { method: 'sendMessageDraft' },
      { after: beforeStop, before: savedAnswer.position },
    );

    expectEqual(
      [
        streamedDraft,
        generatorStopReason,
        savedAnswer.parameters.text,
        await ada.getMessageDraft({ chat: privateChat }),
        (await ada.getMessages({ chat: privateChat })).map(({ text }) => text),
        botErrors,
      ],
      [
        shownDraft(draftId, 'The answer', { can_stop: true }),
        'stopped by the user',
        'The answer (stopped)',
        null,
        ['/start', '/ask', 'The answer (stopped)'],
        [],
      ],
      'Expected the stop to abort the generator, whose partial answer the bot saved',
    );
  } finally {
    for (const release of chunkReleases) {
      release.resolve();
    }
    for (const generation of generations.values()) {
      generation.abort('test finished');
    }
    await runner.stop();
    await session.end();
  }
});

Deno.test('the TypeScript client decodes message drafts strictly', () => {
  const decoded = [
    { message_draft: null },
    { message_draft: shownDraft('-5', '', { is_stopped: true }) },
    { message_draft: { ...shownDraft('5', ''), draft_id: 5 } },
    { message_draft: shownDraft('0', '') },
    { message_draft: shownDraft('5', 'x', { entities: [] }) },
    { message_draft: { draft_id: '5', text: 'x', can_stop: false, keep_on_stop: false } },
    { message_draft: { ...shownDraft('5', 'x'), stopped_at: 0 } },
  ].map((body) => messageDraftResponseSchema.safeParse(body).success);
  expectEqual(
    decoded,
    [true, true, false, false, false, false, false],
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

/** A stop as the bot receives it, which the update's own checks verify. */
interface ReceivedStop {
  readonly chat: unknown;
  readonly draft_id: unknown;
}

/** The stops among the updates that wait for the bot, read without confirming any. */
async function pendingStops(callBot: BotApiCaller): Promise<ReceivedStop[]> {
  const { body } = await callBot('getUpdates', { timeout: 0 });
  return (body as { result: { stopped_message_generation?: ReceivedStop }[] }).result.flatMap(
    ({ stopped_message_generation }) =>
      stopped_message_generation === undefined ? [] : [stopped_message_generation],
  );
}

/** `'done'` for an account action that succeeded, or the HTTP status it failed with. */
async function draftActionOutcome(action: Promise<void>): Promise<'done' | number | undefined> {
  try {
    await action;
    return 'done';
  } catch (error) {
    if (error instanceof EmulationClientError) {
      return error.status;
    }
    throw error;
  }
}

/** Resolves once `signal` aborts. */
function abortion(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

/** How many updates wait for the bot, read without confirming any. */
async function countPendingUpdates(callBot: BotApiCaller): Promise<number> {
  const { body } = await callBot('getUpdates', { timeout: 0 });
  return (body as { result: unknown[] }).result.length;
}

/**
 * A draft as an account's client shows it, in the field order the emulator writes: without a Stop
 * button unless `details` gives one.
 */
function shownDraft(
  draft_id: string,
  text: string,
  details: Partial<Pick<MessageDraft, 'entities' | 'can_stop' | 'keep_on_stop' | 'is_stopped'>> =
    {},
): MessageDraft {
  return {
    draft_id,
    text,
    ...(details.entities === undefined ? {} : { entities: details.entities }),
    can_stop: details.can_stop ?? false,
    keep_on_stop: details.keep_on_stop ?? false,
    is_stopped: details.is_stopped ?? false,
  };
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
