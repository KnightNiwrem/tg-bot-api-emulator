/**
 * Every file the emulator stores keeps a well-formed media type, whichever way its content came:
 * a web resource names a well-formed `Content-Type`, and a bot's upload is typed by its file name
 * whatever its multipart part's `Content-Type` says.
 */
import { assertEquals } from '@std/assert';

import { botApiResult } from '../support/bot_api_requests.ts';
import { requestJson } from '../support/emulation_api.ts';
import { createPrivateConversationFixture } from '../support/http_fixtures.ts';

Deno.test('A web resource is refused unless its content type is a well-formed Content-Type', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath } = fixture;
  const register = (contentType: string) =>
    requestJson<{ reason?: string }>(api, 'POST', `${sessionPath}/web-resources`, {
      url: 'https://files.example/report.pdf',
      content_type: contentType,
      content_base64: btoa('%PDF-1.4'),
    });

  const refusals = await Promise.all(
    ['application/pdf garbage', 'application/pdf; charset', 'application/*', 'pdf'].map(register),
  );
  const accepted = await register('Application/PDF; Version="1.4"');

  assertEquals(
    refusals.map(({ status, body }) => ({ status, reason: body.reason })),
    Array(4).fill({ status: 400, reason: 'content_type_invalid' }),
    'Expected each malformed or ranged content type refused by its reason',
  );
  assertEquals(accepted.status, 201, 'Expected a well-formed content type with parameters');
});

Deno.test('A bot upload is typed by its file name, whatever its part says', async () => {
  await using fixture = await createPrivateConversationFixture();
  const { api, sessionPath, botApiPath, createdAccount, sendText } = fixture;
  await sendText('/start');
  const body = new FormData();
  body.append('chat_id', String(createdAccount.account.id));
  body.append(
    'document',
    new File(['%PDF-1.4'], 'report.pdf', { type: 'application/pdf garbage' }),
  );

  const response = await api.request(`${botApiPath}/sendDocument`, { method: 'POST', body });
  const document = botApiResult(await response.json())?.document as
    | { readonly mime_type?: string; readonly file_unique_id?: string }
    | undefined;
  const download = await api.request(`${sessionPath}/files/${document?.file_unique_id}`);

  assertEquals(response.status, 200, 'Expected the upload accepted');
  assertEquals(document?.mime_type, 'application/pdf', 'Expected the type of its file name');
  assertEquals(download.status, 200, 'Expected the stored file downloaded');
  assertEquals(download.headers.get('Content-Type'), 'application/pdf');
  assertEquals(await download.text(), '%PDF-1.4');
});
