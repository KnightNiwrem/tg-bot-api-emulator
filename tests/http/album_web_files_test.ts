/**
 * Albums whose files Telegram downloads from URLs: as the official Bot API server's
 * `on_message_send_failed` reports it, an album fails at the first message whose file Telegram's
 * servers cannot download or cannot send, with their own error rather than the reworded one a
 * single message gets.
 */
import { assertEquals } from '@std/assert';

import { callBotApi } from '../support/bot_api_requests.ts';
import { jsonRequest } from '../support/emulation_api.ts';
import { createPrivateConversationFixture } from '../support/http_fixtures.ts';
import { isBadRequestResponse } from '../support/http_response_guards.ts';

Deno.test('an album fails at the first document Telegram cannot download or send', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, botApiPath, createdAccount, sendText } = fixture;
  await sendText('/start');
  for (
    const resource of [
      {
        url: 'https://cdn.example.com/report.pdf',
        content_type: 'application/pdf',
        content_base64: new TextEncoder().encode('%PDF-1.7 report').toBase64(),
      },
      {
        url: 'https://cdn.example.com/notes.txt',
        content_type: 'text/plain',
        content_base64: new TextEncoder().encode('notes').toBase64(),
      },
    ]
  ) {
    const registration = await api.request(
      `${sessionPath}/web-resources`,
      jsonRequest('POST', resource),
    );
    if (registration.status !== 201) {
      throw new Error(`Expected ${resource.url} to be registered, received ${registration.status}`);
    }
  }

  const albums = [
    [
      { type: 'document', media: 'https://cdn.example.com/missing.pdf' },
      { type: 'document', media: 'https://cdn.example.com/report.pdf' },
    ],
    [
      { type: 'document', media: 'https://cdn.example.com/report.pdf' },
      { type: 'document', media: 'https://cdn.example.com/notes.txt' },
    ],
  ];
  const descriptions = [];
  for (const media of albums) {
    const { status, body } = await callBotApi(api, `${botApiPath}/sendMediaGroup`, {
      chat_id: createdAccount.account.id,
      media,
    });
    descriptions.push(status === 400 && isBadRequestResponse(body) ? body.description : status);
  }
  assertEquals(descriptions, [
    'Bad Request: failed to send message #1 with the error message "WEBPAGE_CURL_FAILED"',
    'Bad Request: failed to send message #2 with the error message "WEBPAGE_MEDIA_EMPTY"',
  ], "Expected Telegram's errors for each album");
});
