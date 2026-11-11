/**
 * The order in which `answerInlineQuery` reads its results. As the official Bot API server's
 * `get_inline_query_results` does, it parses every result in turn, then resolves the bots their
 * login buttons name, and only then checks the button, the number of results and each result in
 * turn as TDLib's `answer_inline_query` does, so a later result's parse error wins over an earlier
 * result's TDLib error.
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

/** A keyboard whose URL button has no host, which TDLib refuses. */
const invalidUrlKeyboard = { inline_keyboard: [[{ text: 'URL', url: 'https://' }]] };
const INVALID_URL_DESCRIPTION =
  "Bad Request: inline keyboard button URL 'https://' is invalid: URL host is empty";

/** A keyboard whose login button names a bot by a username the server cannot parse. */
const invalidLoginKeyboard = {
  inline_keyboard: [[{
    text: 'Login',
    login_url: { url: 'https://example.com', bot_username: 'bad!' },
  }]],
};
const INVALID_LOGIN_DESCRIPTION = "Bad Request: can't parse InlineQueryResult: Can't parse " +
  'InlineKeyboardButton: LoginUrl bot username is invalid';

/** A keyboard whose login button names no bot of the session. */
const unknownLoginKeyboard = {
  inline_keyboard: [[{
    text: 'Login',
    login_url: { url: 'https://example.com', bot_username: 'no_such_login_bot' },
  }]],
};

/** One more result than an answer may hold, all well formed. */
function tooManyResults(): Record<string, unknown>[] {
  return Array.from({ length: 51 }, (_, index) => articleResult(`r${index}`));
}

const TOO_MANY_RESULTS_DESCRIPTION = 'Bad Request: too many inline query results specified';

/**
 * Answers an inline query of a new session's bot, returning the status and description; the
 * query does not exist, so every check made before its state is read shows.
 */
async function createInlineAnswerCaller() {
  const session = await createTestSession();
  const { botApiPath } = await createBot(session.api, session.sessionPath, 'cats_bot');
  const answerInlineQuery = async (parameters: Readonly<Record<string, unknown>>) => {
    const { status, body } = await callBotApi(session.api, `${botApiPath}/answerInlineQuery`, {
      inline_query_id: '1',
      ...parameters,
    });
    return [status, (body as { readonly description?: string }).description];
  };
  return { session, answerInlineQuery };
}

// The official server parses every result, then resolves the bots their login buttons name
// (Client.cpp#L15449-L15474); TDLib's `answer_inline_query` then checks the button, then the number
// of results, then each result (InlineQueriesManager.cpp#L704-L751).
Deno.test('An inline query answer checks its button and result count before any result', async () => {
  const { session, answerInlineQuery } = await createInlineAnswerCaller();
  await using _session = session;
  const startButton = (startParameter: string) => ({
    text: 'Start',
    start_parameter: startParameter,
  });

  const answers = {
    resultKeyboardAlone: await answerInlineQuery({
      results: [articleResult('1', { reply_markup: invalidUrlKeyboard })],
    }),
    longStartParameterBeforeResultKeyboard: await answerInlineQuery({
      results: [articleResult('1', { reply_markup: invalidUrlKeyboard })],
      button: startButton('a'.repeat(65)),
    }),
    emptyStartParameterBeforeResultContent: await answerInlineQuery({
      results: [locationOffEarthResult('1')],
      button: startButton(''),
    }),
    unallowedStartParameterBeforeResultKeyboard: await answerInlineQuery({
      results: [articleResult('1', { reply_markup: invalidUrlKeyboard })],
      button: startButton('+'),
    }),
    startParameterBeforeResultCount: await answerInlineQuery({
      results: tooManyResults(),
      button: startButton('+'),
    }),
    resultCountBeforeFirstResultKeyboard: await answerInlineQuery({
      results: [
        articleResult('r0', { reply_markup: invalidUrlKeyboard }),
        ...tooManyResults().slice(1),
      ],
    }),
    resultCountBeforeLastResultKeyboard: await answerInlineQuery({
      results: [
        ...tooManyResults().slice(0, 50),
        articleResult('r50', { reply_markup: invalidUrlKeyboard }),
      ],
    }),
    lastResultParseBeforeResultCount: await answerInlineQuery({
      results: [...tooManyResults().slice(0, 50), unclosedHtmlResult('r50')],
    }),
    resultParseBeforeStartParameter: await answerInlineQuery({
      results: [unclosedHtmlResult('1')],
      button: startButton('+'),
    }),
    loginLookupBeforeResultCount: await answerInlineQuery({
      results: [
        articleResult('r0', { reply_markup: unknownLoginKeyboard }),
        ...tooManyResults().slice(1),
      ],
    }),
    earlierLoginParseBeforeLaterText: await answerInlineQuery({
      results: [
        articleResult('1', { reply_markup: invalidLoginKeyboard }),
        unclosedHtmlResult('2'),
      ],
    }),
  };

  assertEquals(answers, {
    resultKeyboardAlone: [400, INVALID_URL_DESCRIPTION],
    longStartParameterBeforeResultKeyboard: [
      400,
      'Bad Request: too long start_parameter specified',
    ],
    emptyStartParameterBeforeResultContent: [400, "Bad Request: can't use empty start_parameter"],
    unallowedStartParameterBeforeResultKeyboard: [
      400,
      'Bad Request: unallowed characters in start_parameter are used',
    ],
    startParameterBeforeResultCount: [
      400,
      'Bad Request: unallowed characters in start_parameter are used',
    ],
    resultCountBeforeFirstResultKeyboard: [400, TOO_MANY_RESULTS_DESCRIPTION],
    resultCountBeforeLastResultKeyboard: [400, TOO_MANY_RESULTS_DESCRIPTION],
    lastResultParseBeforeResultCount: [400, UNCLOSED_HTML_DESCRIPTION],
    resultParseBeforeStartParameter: [400, UNCLOSED_HTML_DESCRIPTION],
    loginLookupBeforeResultCount: [400, 'Bad Request: bot "no_such_login_bot" not found'],
    earlierLoginParseBeforeLaterText: [400, INVALID_LOGIN_DESCRIPTION],
  });
});

// `get_inline_query_result` reads `input_message_content` and its text, then the caption and its
// text, then `reply_markup` and its buttons, then the fields of the result's type
// (Client.cpp#L11030-L11299).
Deno.test('An inline query result is parsed in the order of its fields', async () => {
  const { session, answerInlineQuery } = await createInlineAnswerCaller();
  await using _session = session;
  const unclosedContent = { message_text: '<b>', parse_mode: 'HTML' };
  const unclosedCaption = { caption: '<i>', parse_mode: 'HTML' };
  const articleWithoutTitle = {
    type: 'article',
    id: '1',
    input_message_content: { message_text: 'Hi' },
  };
  const photoWithoutFile = { type: 'photo', id: '1' };
  const answerResult = (result: Readonly<Record<string, unknown>>) =>
    answerInlineQuery({ results: [result] });

  const answers = {
    contentBeforeTypeFields: await answerResult({
      ...articleWithoutTitle,
      input_message_content: unclosedContent,
    }),
    captionBeforeTypeFields: await answerResult({ ...articleWithoutTitle, ...unclosedCaption }),
    keyboardBeforeTypeFields: await answerResult({
      ...articleWithoutTitle,
      reply_markup: invalidLoginKeyboard,
    }),
    contentBeforeCaption: await answerResult(
      articleResult('1', { input_message_content: unclosedContent, ...unclosedCaption }),
    ),
    captionBeforeKeyboard: await answerResult(
      articleResult('1', { ...unclosedCaption, reply_markup: invalidLoginKeyboard }),
    ),
    mediaCaptionBeforeFile: await answerResult({ ...photoWithoutFile, ...unclosedCaption }),
    mediaKeyboardBeforeFile: await answerResult({
      ...photoWithoutFile,
      reply_markup: invalidLoginKeyboard,
    }),
    contentBeforeUnknownType: await answerResult({
      type: 'unknown',
      id: '1',
      input_message_content: unclosedContent,
    }),
  };

  const unclosedItalicDescription = "Bad Request: can't parse InlineQueryResult: Can't parse " +
    `entities: Can't find end tag corresponding to start tag "i"`;
  const unclosedBoldDescription = "Bad Request: can't parse InlineQueryResult: Can't parse " +
    `entities: Can't find end tag corresponding to start tag "b"`;
  assertEquals(answers, {
    contentBeforeTypeFields: [400, unclosedBoldDescription],
    captionBeforeTypeFields: [400, unclosedItalicDescription],
    keyboardBeforeTypeFields: [400, INVALID_LOGIN_DESCRIPTION],
    contentBeforeCaption: [400, unclosedBoldDescription],
    captionBeforeKeyboard: [400, unclosedItalicDescription],
    mediaCaptionBeforeFile: [400, unclosedItalicDescription],
    mediaKeyboardBeforeFile: [400, INVALID_LOGIN_DESCRIPTION],
    contentBeforeUnknownType: [400, unclosedBoldDescription],
  });
});
