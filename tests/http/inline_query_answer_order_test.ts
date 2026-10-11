/**
 * The order in which `answerInlineQuery` reads its results: one at a time, as the official Bot API
 * server's `get_inline_query_results` reads them, so each result's fields, inline keyboard and
 * content are read before the next result.
 */
import { assertEquals } from '@std/assert';

import { callBotApi } from '../support/bot_api_requests.ts';
import { createTestSession } from '../support/emulation_api.ts';
import { createBot } from '../support/http_fixtures.ts';

/** An article result whose fields are well formed, sending `Hi` unless `overrides` say otherwise. */
function articleResult(id: string, overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    type: 'article',
    id,
    title: 'Greeting',
    input_message_content: { message_text: 'Hi' },
    ...overrides,
  };
}

/** A keyboard whose Web App button opens a page over HTTP, where Telegram requires HTTPS. */
const keyboardWithInsecureWebApp = {
  inline_keyboard: [[{ text: 'Open', web_app: { url: 'http://example.com/app' } }]],
};

/** A location north of the North Pole, which names no point on Earth. */
const locationOffEarth = { latitude: 91, longitude: 0 };

/** An article result whose title is not text, which the emulator refuses as malformed. */
function malformedResult(id: string) {
  return articleResult(id, { title: 5 });
}

Deno.test('An inline query answer reads each result fully before the next', async () => {
  await using session = await createTestSession();
  const { botApiPath } = await createBot(session.api, session.sessionPath, 'cats_bot');
  const answerInlineQuery = async (results: readonly unknown[]) => {
    const { status, body } = await callBotApi(session.api, `${botApiPath}/answerInlineQuery`, {
      inline_query_id: '1',
      results,
    });
    return [status, (body as { readonly description?: string }).description];
  };

  const answers = {
    keyboardBeforeLaterFields: await answerInlineQuery([
      articleResult('1', { reply_markup: keyboardWithInsecureWebApp }),
      malformedResult('2'),
    ]),
    contentBeforeLaterFields: await answerInlineQuery([
      articleResult('1', { input_message_content: locationOffEarth }),
      malformedResult('2'),
    ]),
    fieldsBeforeLaterKeyboard: await answerInlineQuery([
      malformedResult('1'),
      articleResult('2', { reply_markup: keyboardWithInsecureWebApp }),
    ]),
  };

  assertEquals(
    answers,
    {
      keyboardBeforeLaterFields: [
        400,
        "Bad Request: inline keyboard button Web App URL 'http://example.com/app' is invalid: " +
        'Only HTTPS links are allowed',
      ],
      contentBeforeLaterFields: [400, 'Bad Request: invalid location specified'],
      fieldsBeforeLaterKeyboard: [400, 'Bad Request: invalid answerInlineQuery parameters'],
    },
    "Expected the first result's keyboard or content refused before the second result's fields, " +
      "and the first result's fields before the second result's keyboard",
  );
});
