/**
 * Reading a JSON body's members as Bot API parameters: a string member as its content, and any
 * other member as the source text the bot wrote, as the official Bot API server's `HttpReader` does.
 */
import { assertEquals } from '@std/assert';
import {
  type BotApiRequestParametersDecoding,
  decodeBotApiBodyParameters,
  decodeBotApiRequestParameters,
} from '../src/api/sessions/bot_api/request_parameters.ts';

const METHOD_URL = 'http://emulator.example/bot123:token/recordParameters';

Deno.test('A JSON body records nested numbers as the bot spelled them', async () => {
  const point = '{"big": 1e500, "small": -1E-500, "id": 9007199254740993, "ratio": 1.0, ' +
    '"hundred": 1e2, "zero": -0, "list": [0.30000000000000001, 18446744073709551616]}';

  assertDecodedParameters(await decodeJsonBody(`{"point": ${point}}`), { point });
});

Deno.test('A JSON body records each value but a string as its exact source text', async () => {
  const body = '{ "id" : 9007199254740993 ,"ratio":1.0,\t"flag" :\ntrue, "none": null,\r\n' +
    '"keyboard": { "inline_keyboard" : [ [ { "text" : "Yes" } ] ] } , "empty": {}, "list": [] }';

  assertDecodedParameters(await decodeJsonBody(body), {
    id: '9007199254740993',
    ratio: '1.0',
    flag: 'true',
    none: 'null',
    keyboard: '{ "inline_keyboard" : [ [ { "text" : "Yes" } ] ] }',
    empty: '{}',
    list: '[]',
  });
});

Deno.test('A JSON body records a string member as its content and nested strings as written', async () => {
  const nested = String
    .raw`{"text":"a \"quoted\" } ] { [ \\","emoji":"\ud83d\ude00","letter":"\u0041"}`;
  const body = String.raw`{"label":"a \"quoted\" } ] { [ \\ \u0041 \ud83d\ude00","nested":` +
    `${nested},"empty":""}`;

  assertDecodedParameters(await decodeJsonBody(body), {
    label: 'a "quoted" } ] { [ \\ A \u{1F600}',
    nested,
    empty: '',
  });
});

Deno.test('A JSON body names parameters by their decoded member names', async () => {
  const body = String.raw`{"\u0063hat_id":1,"__proto__":{"a":1},"constructor":"x","":[]}`;

  assertDecodedParameters(await decodeJsonBody(body), {
    chat_id: '1',
    ['__proto__']: '{"a":1}',
    constructor: 'x',
    '': '[]',
  });
});

Deno.test('A JSON body keeps the first member of a repeated name, as among form fields', async () => {
  assertDecodedParameters(
    await decodeJsonBody('{"offset":1,"limit":5,"offset":2}'),
    { offset: '1', limit: '5' },
  );
});

Deno.test('A JSON body records an empty object as no parameters', async () => {
  for (const body of ['{}', ' \n{ \t}\r\n']) {
    assertDecodedParameters(await decodeJsonBody(body), {});
  }
});

Deno.test('A JSON body records a value nested to the depth limit as its source text', async () => {
  // 50 arrays and 50 objects around a string that looks like closing brackets.
  const deep = `${'[{"a":'.repeat(50)}"]}"${'}]'.repeat(50)}`;

  assertDecodedParameters(await decodeJsonBody(`{"deep":${deep},"after":2}`), {
    deep,
    after: '2',
  });
});

Deno.test('A JSON body refuses a value nested beyond the depth limit, however deep', async () => {
  for (const pairDepth of [51, 100_000]) {
    const deep = `${'[{"a":'.repeat(pairDepth)}"]}"${'}]'.repeat(pairDepth)}`;
    const decoding = await decodeJsonBody(`{"deep":${deep},"after":2}`);
    if (
      decoding.decoded ||
      decoding.description !== "Bad Request: can't parse parameter value: Too big object depth"
    ) {
      throw new Error(`Expected ${pairDepth * 2} levels to be refused as too deep`);
    }
  }
});

Deno.test("A webhook's JSON reply records nested numbers as its source text", async () => {
  const replyMarkup = '{"inline_keyboard":[[{"text":"Pay","pay":true,"id":9007199254740993}]]}';
  const decoding = await decodeBotApiBodyParameters(
    new Response(`{"method":"sendMessage","reply_markup":${replyMarkup}}`, {
      headers: { 'Content-Type': 'application/json' },
    }),
  );

  assertDecodedParameters(decoding, { method: 'sendMessage', reply_markup: replyMarkup });
});

Deno.test('Each encoding records the same text for JSON the bot spelled the same way', async () => {
  const replyMarkup =
    '{"inline_keyboard": [[{"text": "Yes", "callback_data": "1.0"}]], "n": 1e500}';
  const replyParameters = '{"message_id":9007199254740993, "quote_position": 1.0}';
  const expectedParameters = { reply_markup: replyMarkup, reply_parameters: replyParameters };
  const multipartBody = new FormData();
  multipartBody.set('reply_markup', replyMarkup);
  multipartBody.set('reply_parameters', replyParameters);

  const decodings = [
    await decodeJsonBody(
      `{"reply_markup":${replyMarkup},"reply_parameters":${replyParameters}}`,
    ),
    await decodeJsonBody(JSON.stringify(expectedParameters)),
    await decodeBotApiRequestParameters(
      new Request(METHOD_URL, {
        method: 'POST',
        body: new URLSearchParams(expectedParameters),
      }),
    ),
    await decodeBotApiRequestParameters(
      new Request(`${METHOD_URL}?${new URLSearchParams(expectedParameters)}`),
    ),
    await decodeBotApiRequestParameters(
      new Request(METHOD_URL, { method: 'POST', body: multipartBody }),
    ),
  ];

  for (const decoding of decodings) {
    assertDecodedParameters(decoding, expectedParameters);
  }
});

function decodeJsonBody(body: string): Promise<BotApiRequestParametersDecoding> {
  return decodeBotApiRequestParameters(
    new Request(METHOD_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }),
  );
}

/** Checks that the parameters decoded to exactly these, in this order. */
function assertDecodedParameters(
  decoding: BotApiRequestParametersDecoding,
  expectedParameters: Readonly<Record<string, string>>,
): void {
  if (!decoding.decoded) {
    throw new Error(`Expected parameters to decode, received "${decoding.description}"`);
  }
  // The entries compare the parameters' order too.
  assertEquals(
    Object.entries(decoding.parameters),
    Object.entries(expectedParameters),
    'Expected the parameters decoded in this order',
  );
}
