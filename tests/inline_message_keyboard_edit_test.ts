import { createTestSession, type EmulationApi, requestJson } from './support/emulation_api.ts';

// A bot can change only the keyboard of a message an account sent through its inline mode, which
// keeps the message's content-edit time, absent before any content edit. What Telegram sends the
// chat's bot for such an edit is not established yet (#164), so these tests record the emulator's
// current output: an `edited_message` without `edit_date`. The Bot API type conformance check
// lists that field as unclassified for the same reason.

type ReceivedMessage = Readonly<Record<string, unknown>>;

interface ReceivedUpdate {
  readonly update_id: number;
  readonly message?: ReceivedMessage;
  readonly edited_message?: ReceivedMessage;
  readonly chosen_inline_result?: { readonly inline_message_id?: string };
}

type InlineQueryChat =
  | { readonly type: 'private'; readonly botId: number }
  | { readonly type: 'supergroup'; readonly chatId: number };

const SENT_KEYBOARD = { inline_keyboard: [[{ text: 'More', callback_data: 'more' }]] };
const REPLACEMENT_KEYBOARD = { inline_keyboard: [[{ text: 'Less', callback_data: 'less' }]] };

/**
 * Creates a session where Ada sends, through an inline bot that receives chosen results, an
 * article with `SENT_KEYBOARD`, in her private chat with the bot or in a supergroup she owns that
 * the bot is a member of. Returns the message the bot received and the inline message ID of the
 * chosen result.
 */
async function sendInlineArticleWithKeyboard(chatType: InlineQueryChat['type']) {
  const { api, sessionPath } = await createTestSession();
  const { body: { account: ada } } = await requestJson<{ account: { id: number } }>(
    api,
    'POST',
    `${sessionPath}/accounts`,
    { first_name: 'Ada' },
  );
  const { body: { token, bot } } = await requestJson<{ token: string; bot: { id: number } }>(
    api,
    'POST',
    `${sessionPath}/bots`,
    {
      first_name: 'Cats Bot',
      username: 'cats_bot',
      supports_inline_queries: true,
      receives_chosen_inline_results: true,
    },
  );
  const accountPath = `${sessionPath}/accounts/${ada.id}`;
  const botApiPath = `${sessionPath}/bot-api/bot${token}`;
  const chat = await openInlineQueryChat(api, accountPath, bot.id, chatType);
  const readUpdates = createUpdateReader(api, botApiPath);
  await readUpdates();

  const { body: { inline_query: inlineQuery } } = await requestJson<
    { inline_query: { id: string } }
  >(api, 'POST', `${accountPath}/inline-queries`, { bot_id: bot.id, chat, query: 'cats' });
  await expectBotApiResult(api, botApiPath, 'answerInlineQuery', {
    inline_query_id: inlineQuery.id,
    results: [{
      type: 'article',
      id: 'fact',
      title: 'Cat fact',
      input_message_content: { message_text: 'Cats sleep a lot' },
      reply_markup: SENT_KEYBOARD,
    }],
  });
  await requestJson(
    api,
    'POST',
    `${accountPath}/inline-queries/${inlineQuery.id}/chosen-results`,
    { result_id: 'fact' },
  );
  const updates = await readUpdates();
  const sentMessage = updates.find((update) => update.message !== undefined)?.message;
  const inlineMessageId = updates.find((update) => update.chosen_inline_result !== undefined)
    ?.chosen_inline_result?.inline_message_id;
  if (sentMessage === undefined || inlineMessageId === undefined) {
    throw new Error(`Expected a message and a chosen result, received ${JSON.stringify(updates)}`);
  }
  expectEqual(
    [sentMessage.text, sentMessage.reply_markup, Object.hasOwn(sentMessage, 'edit_date')],
    ['Cats sleep a lot', SENT_KEYBOARD, false],
    'Expected the bot to receive the unedited article',
  );
  return { api, botApiPath, readUpdates, sentMessage, inlineMessageId };
}

/** Starts Ada's private chat with the bot, or creates her supergroup and adds the bot to it. */
async function openInlineQueryChat(
  api: EmulationApi,
  accountPath: string,
  botId: number,
  chatType: InlineQueryChat['type'],
): Promise<InlineQueryChat> {
  if (chatType === 'private') {
    return { type: 'private', botId };
  }
  const { body: { supergroup } } = await requestJson<{ supergroup: { id: number } }>(
    api,
    'POST',
    `${accountPath}/supergroups`,
    { title: 'Cat Lovers' },
  );
  const membership = await api.request(
    `${accountPath}/conversations/supergroup/${supergroup.id}/members/${botId}`,
    { method: 'PUT' },
  );
  if (!membership.ok) {
    throw new Error(`Expected the bot to join the supergroup, received ${membership.status}`);
  }
  return { type: 'supergroup', chatId: supergroup.id };
}

function createUpdateReader(api: EmulationApi, botApiPath: string) {
  let nextOffset = 0;
  return async (): Promise<readonly ReceivedUpdate[]> => {
    const { body } = await requestJson<{ result: ReceivedUpdate[] }>(
      api,
      'POST',
      `${botApiPath}/getUpdates`,
      { offset: nextOffset },
    );
    const lastUpdateId = body.result.at(-1)?.update_id;
    if (lastUpdateId !== undefined) {
      nextOffset = lastUpdateId + 1;
    }
    return body.result;
  };
}

async function expectBotApiResult(
  api: EmulationApi,
  botApiPath: string,
  method: string,
  parameters: Record<string, unknown>,
): Promise<void> {
  const { body } = await requestJson<unknown>(api, 'POST', `${botApiPath}/${method}`, parameters);
  expectEqual(body, { ok: true, result: true }, `Expected ${method} to succeed`);
}

function expectEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}

for (const chatType of ['private', 'supergroup'] as const) {
  Deno.test(`a keyboard-only edit of an account's inline message in a ${chatType} chat reaches its bot without edit_date`, async () => {
    const { api, botApiPath, readUpdates, sentMessage, inlineMessageId } =
      await sendInlineArticleWithKeyboard(chatType);

    await expectBotApiResult(api, botApiPath, 'editMessageReplyMarkup', {
      inline_message_id: inlineMessageId,
      reply_markup: REPLACEMENT_KEYBOARD,
    });

    // The serialized message differs from the one sent only in its keyboard: no `edit_date`.
    expectEqual(
      (await readUpdates()).map(({ update_id: _updateId, ...update }) => update),
      [{ edited_message: { ...sentMessage, reply_markup: REPLACEMENT_KEYBOARD } }],
      'Expected the bot to receive the keyboard-only edit',
    );
  });
}
