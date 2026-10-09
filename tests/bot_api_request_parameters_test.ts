import {
  booleanParameter,
  type BotApiRequestParametersDecoding,
  decodeBotApiRequestParameters,
} from '../src/api/sessions/bot_api/request_parameters.ts';

const METHOD_URL = 'http://emulator.example/bot123:token/getUpdates';

Deno.test("booleanParameter reads Telegram's boolean spellings and rejects other text", () => {
  const cases: [string, boolean][] = [
    ['true', true],
    [' YES ', true],
    ['1', true],
    ['False', false],
    ['no', false],
    ['0', false],
  ];
  for (const [text, expected] of cases) {
    const parsed = booleanParameter().safeParse(text);
    if (!parsed.success || parsed.data !== expected) {
      throw new Error(`Expected ${JSON.stringify(text)} to be read as ${expected}`);
    }
  }
  for (const text of ['', 'maybe', '2']) {
    if (booleanParameter().safeParse(text).success) {
      throw new Error(`Expected ${JSON.stringify(text)} to be rejected`);
    }
  }
});

Deno.test('decodeBotApiRequestParameters decodes every supported body encoding alike', async () => {
  const expectedParameters = { offset: '2', allowed_updates: '["message"]' };
  const multipartBody = new FormData();
  multipartBody.set('offset', '2');
  multipartBody.set('allowed_updates', '["message"]');

  const decodings = [
    await decodeBotApiRequestParameters(
      new Request(METHOD_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offset: 2, allowed_updates: ['message'] }),
      }),
    ),
    await decodeBotApiRequestParameters(
      new Request(METHOD_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ offset: '2', allowed_updates: '["message"]' }),
      }),
    ),
    await decodeBotApiRequestParameters(
      new Request(METHOD_URL, {
        method: 'POST',
        body: new URLSearchParams(expectedParameters),
      }),
    ),
    await decodeBotApiRequestParameters(
      new Request(METHOD_URL, { method: 'POST', body: multipartBody }),
    ),
  ];

  for (const decoding of decodings) {
    assertDecodedParameters(decoding, expectedParameters);
  }
});

Deno.test('decodeBotApiRequestParameters keeps the text of JSON numbers beyond safe integers', async () => {
  const decoding = await decodeBotApiRequestParameters(
    new Request(METHOD_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"draft_id": 9007199254740993, "message_effect_id": -9223372036854775808, ' +
        '"latitude": 51.50, "reply_markup": {"inline_keyboard": []}}',
    }),
  );

  assertDecodedParameters(decoding, {
    draft_id: '9007199254740993',
    message_effect_id: '-9223372036854775808',
    latitude: '51.50',
    reply_markup: '{"inline_keyboard":[]}',
  });
});

Deno.test('decodeBotApiRequestParameters reads the query string, preferring it to the body', async () => {
  const queryOnlyDecoding = await decodeBotApiRequestParameters(
    new Request(`${METHOD_URL}?offset=2&allowed_updates=%5B%22message%22%5D`),
  );
  assertDecodedParameters(queryOnlyDecoding, { offset: '2', allowed_updates: '["message"]' });

  const decoding = await decodeBotApiRequestParameters(
    new Request(`${METHOD_URL}?offset=5`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offset: 2, limit: 1 }),
    }),
  );

  assertDecodedParameters(decoding, { offset: '5', limit: '1' });
});

Deno.test('decodeBotApiRequestParameters keeps the first multipart file of each name', async () => {
  const body = new FormData();
  body.append('chat_id', '5');
  body.append('document', 'attach://report');
  body.append('report', new File(['first'], 'report.pdf'));
  body.append('report', new File(['second'], 'other.pdf'));

  const decoding = await decodeBotApiRequestParameters(
    new Request(METHOD_URL, { method: 'POST', body }),
  );

  assertDecodedParameters(decoding, { chat_id: '5', document: 'attach://report' });
  const uploadedFile = decoding.decoded ? decoding.uploadedFiles.get('report') : undefined;
  if (
    decoding.decoded && decoding.uploadedFiles.size !== 1 ||
    uploadedFile?.fileName !== 'report.pdf' ||
    new TextDecoder().decode(uploadedFile.content) !== 'first'
  ) {
    throw new Error('Expected the first file of the name, with its name and content');
  }
});

Deno.test('decodeBotApiRequestParameters rejects bodies it cannot decode', async () => {
  const undecodableRequests = [
    new Request(METHOD_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    }),
    new Request(METHOD_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '[2]',
    }),
    new Request(METHOD_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'offset=2',
    }),
  ];

  for (const request of undecodableRequests) {
    const decoding = await decodeBotApiRequestParameters(request);
    if (decoding.decoded || !decoding.description.startsWith('Bad Request: ')) {
      throw new Error(
        `Expected a ${request.headers.get('Content-Type')} body to be rejected as a bad request`,
      );
    }
  }
});

function assertDecodedParameters(
  decoding: BotApiRequestParametersDecoding,
  expectedParameters: Readonly<Record<string, string>>,
): void {
  if (!decoding.decoded) {
    throw new Error(`Expected parameters to decode, received "${decoding.description}"`);
  }
  if (JSON.stringify(decoding.parameters) !== JSON.stringify(expectedParameters)) {
    throw new Error(
      `Expected ${JSON.stringify(expectedParameters)}, received ${
        JSON.stringify(decoding.parameters)
      }`,
    );
  }
}
