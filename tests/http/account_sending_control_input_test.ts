/**
 * The input of what an account sends: limits by code point, base64 content, poll rules, and the
 * answer of a reply keyboard press, each reported at its body field; the album and file rules the
 * server, not the wire schema, refuses with their own reasons; and the media attributes an account
 * defines, which no bot-side clamp bounds.
 */
import { assertEquals } from '@std/assert';

import type { ControlErrorBody } from '../../clients/typescript/mod.ts';
import { callBotApi, updateMessages } from '../support/bot_api_requests.ts';
import { requestJson } from '../support/emulation_api.ts';
import { createPrivateConversationFixture } from '../support/http_fixtures.ts';

interface RefusalDescription {
  readonly status: number;
  readonly reason: string;
  readonly issues?: readonly {
    readonly source: string;
    readonly path: readonly (string | number)[];
    readonly code: string;
  }[];
}

/** The status and reason of a refusal, and the source, path and code of each of its issues. */
function describeRefusal(
  { status, body }: { status: number; body: ControlErrorBody },
): RefusalDescription {
  return {
    status,
    reason: body.reason,
    issues: body.issues?.map(({ source, path, code }) => ({ source, path, code })),
  };
}

function invalidRequest(path: readonly (string | number)[], code: string): RefusalDescription {
  return { status: 400, reason: 'invalid_request', issues: [{ source: 'body', path, code }] };
}

function refusal(reason: string): RefusalDescription {
  return { status: 400, reason, issues: undefined };
}

Deno.test('What an account sends is refused at the body field that breaks a rule', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, createdBot, createdAccount } = fixture;
  const accountPath = `${sessionPath}/accounts/${createdAccount.account.id}`;
  const to = { type: 'private', botId: createdBot.bot.id };
  const send = (body: Record<string, unknown>) =>
    requestJson<ControlErrorBody>(api, 'POST', `${accountPath}/messages`, { to, ...body });
  const poll = { question: 'Lunch?', options: [{ text: 'Pizza' }, { text: 'Pasta' }] };

  const refusals = [
    await send({ text: '😀'.repeat(4097) }),
    await send({ contact: { phone_number: '15550100', first_name: '😀'.repeat(65) } }),
    await send({
      contact: { phone_number: '15550100', first_name: 'Ada', vcard: 'x'.repeat(2049) },
    }),
    await send({ photo: { content_base64: 'not base64!' } }),
    await send({ poll: { ...poll, explanation: 'Because' } }),
    await send({
      poll: { ...poll, type: 'quiz', correct_option_ids: [0], explanation_entities: [] },
    }),
    await send({ document: { content_base64: '', file_name: 'empty.txt' } }),
    await requestJson<ControlErrorBody>(api, 'POST', `${accountPath}/media-groups`, {
      to,
      media: [],
    }),
  ];

  assertEquals(
    refusals.map(describeRefusal),
    [
      invalidRequest(['text'], 'too_big'),
      invalidRequest(['contact', 'first_name'], 'too_big'),
      invalidRequest(['contact', 'vcard'], 'invalid_value'),
      invalidRequest(['photo', 'content_base64'], 'invalid_value'),
      invalidRequest(['poll'], 'invalid_value'),
      invalidRequest(['poll'], 'invalid_value'),
      refusal('file_empty'),
      refusal('album_empty'),
    ],
    'Expected each refusal at its field, or with the reason Telegram gives',
  );
});

Deno.test('An account media fixture keeps attributes beyond what the Bot API server clamps a bot to', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, botApiPath, createdBot, createdAccount } = fixture;
  const accountPath = `${sessionPath}/accounts/${createdAccount.account.id}`;
  const to = { type: 'private', botId: createdBot.bot.id };
  const content_base64 = new TextEncoder().encode('bytes the emulator never decodes').toBase64();
  // The official server clamps a bot's durations to 86,400 seconds and video sides to 10,000.
  const sent = [
    { video: { content_base64, duration: 172_800, width: 12_000, height: 16_000 } },
    { voice: { content_base64, duration: 90_000 } },
    { audio: { content_base64, duration: 100_000 } },
  ];

  const statuses = [];
  for (const body of sent) {
    statuses.push(
      (await requestJson(api, 'POST', `${accountPath}/messages`, { to, ...body })).status,
    );
  }
  const received = updateMessages((await callBotApi(api, `${botApiPath}/getUpdates`, {})).body)
    .map(({ video, voice, audio }) => {
      const media = (video ?? voice ?? audio) as Record<string, unknown>;
      return { duration: media.duration, width: media.width, height: media.height };
    });

  assertEquals(statuses, [201, 201, 201], 'Expected each fixture to be sent');
  assertEquals(
    received,
    [
      { duration: 172_800, width: 12_000, height: 16_000 },
      { duration: 90_000, width: undefined, height: undefined },
      { duration: 100_000, width: undefined, height: undefined },
    ],
    'Expected the bot to receive each attribute as the account defined it',
  );
});

Deno.test('A reply keyboard press takes at most one answer, and Web App data of some bytes', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, createdBot, createdAccount } = fixture;
  const pressPath = `${sessionPath}/accounts/${createdAccount.account.id}/reply-keyboard-presses`;
  const chat = { type: 'private', botId: createdBot.bot.id };
  const press = (body: Record<string, unknown>) =>
    requestJson<ControlErrorBody>(api, 'POST', pressPath, { chat, text: 'Go', ...body });

  const refusals = [
    await press({ web_app_data: '' }),
    await press({ web_app_data: 'x'.repeat(4097) }),
    await press({ shared_chat_id: -1_000_000_000_001, web_app_data: 'data' }),
  ];

  assertEquals(
    refusals.map(describeRefusal),
    [
      invalidRequest(['web_app_data'], 'too_small'),
      invalidRequest(['web_app_data'], 'invalid_value'),
      invalidRequest([], 'invalid_value'),
    ],
    'Expected each refusal reported at its body field',
  );
});
