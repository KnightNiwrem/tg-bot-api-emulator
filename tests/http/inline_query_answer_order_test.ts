/**
 * The order in which `answerInlineQuery` reads its results. As the official Bot API server's
 * `get_inline_query_results` does, it parses every result in turn, fields, text and caption, and
 * only then checks them in turn as TDLib's `answer_inline_query` does, so a later result's parse
 * error wins over an earlier result's TDLib error.
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

/** An article result whose title is not text, which the server cannot parse. */
function malformedResult(id: string) {
  return articleResult(id, { title: 5 });
}

/** An article result whose HTML does not close its tag, which the server cannot parse. */
function unclosedHtmlResult(id: string) {
  return articleResult(id, {
    input_message_content: { message_text: '<b>Hi', parse_mode: 'HTML' },
  });
}

/** A keyboard that opens a Web App over HTTP, which TDLib refuses, requiring HTTPS. */
const insecureWebAppKeyboard = {
  inline_keyboard: [[{ text: 'Open', web_app: { url: 'http://example.com/app' } }]],
};

/** A location north of the North Pole to send, which TDLib refuses. */
const locationOffEarthContent = { latitude: 91, longitude: 0 };

function insecureWebAppResult(id: string) {
  return articleResult(id, { reply_markup: insecureWebAppKeyboard });
}

function locationOffEarthResult(id: string) {
  return articleResult(id, { input_message_content: locationOffEarthContent });
}

const MALFORMED_DESCRIPTION = 'Bad Request: invalid answerInlineQuery parameters';
const UNCLOSED_HTML_DESCRIPTION = "Bad Request: can't parse InlineQueryResult: Can't parse " +
  `entities: Can't find end tag corresponding to start tag "b"`;
const INSECURE_WEB_APP_DESCRIPTION =
  "Bad Request: inline keyboard button Web App URL 'http://example.com/app' is invalid: " +
  'Only HTTPS links are allowed';
const LOCATION_INVALID_DESCRIPTION = 'Bad Request: invalid location specified';

Deno.test('An inline query answer parses every result before TDLib checks any', async () => {
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
    earlierTextParseBeforeLaterFields: await answerInlineQuery([
      unclosedHtmlResult('1'),
      malformedResult('2'),
    ]),
    laterFieldsBeforeEarlierKeyboard: await answerInlineQuery([
      insecureWebAppResult('1'),
      malformedResult('2'),
    ]),
    laterTextParseBeforeEarlierContent: await answerInlineQuery([
      locationOffEarthResult('1'),
      unclosedHtmlResult('2'),
    ]),
    earlierKeyboardBeforeLaterContent: await answerInlineQuery([
      insecureWebAppResult('1'),
      locationOffEarthResult('2'),
    ]),
    earlierContentBeforeLaterKeyboard: await answerInlineQuery([
      locationOffEarthResult('1'),
      insecureWebAppResult('2'),
    ]),
  };

  assertEquals(
    answers,
    {
      earlierTextParseBeforeLaterFields: [400, UNCLOSED_HTML_DESCRIPTION],
      laterFieldsBeforeEarlierKeyboard: [400, MALFORMED_DESCRIPTION],
      laterTextParseBeforeEarlierContent: [400, UNCLOSED_HTML_DESCRIPTION],
      earlierKeyboardBeforeLaterContent: [400, INSECURE_WEB_APP_DESCRIPTION],
      earlierContentBeforeLaterKeyboard: [400, LOCATION_INVALID_DESCRIPTION],
    },
    'Expected parse errors in result order, then TDLib errors in result order',
  );
});

Deno.test('TDLib checks a result file MIME type before its keyboard and content', async () => {
  await using session = await createTestSession();
  const { botApiPath } = await createBot(session.api, session.sessionPath, 'cats_bot');
  const document = {
    type: 'document',
    id: '1',
    title: 'Notes',
    document_url: 'https://example.com/notes.txt',
    mime_type: 'text/plain',
  };

  const { status, body } = await callBotApi(session.api, `${botApiPath}/answerInlineQuery`, {
    inline_query_id: '1',
    results: [{
      ...document,
      reply_markup: insecureWebAppKeyboard,
      input_message_content: locationOffEarthContent,
    }],
  });

  assertEquals(
    [status, (body as { readonly description?: string }).description],
    [400, 'Bad Request: unallowed document MIME type'],
    "Expected get_input_bot_inline_result's MIME type check before get_inline_message's",
  );
});
