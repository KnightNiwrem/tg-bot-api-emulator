/**
 * The body of a web resource registration: its content is base64 text, read as
 * `Uint8Array.fromBase64` reads it, and other text is an issue of the body.
 */
import { assertEquals } from '@std/assert';

import type { ControlErrorBody } from '../../clients/typescript/mod.ts';
import { createTestSession, requestJson } from '../support/emulation_api.ts';

Deno.test('Web resource content is base64 text, with or without its padding', async () => {
  const { api, sessionPath } = await createTestSession();
  const register = (contentBase64: string) =>
    requestJson<{ content_length: number }>(api, 'POST', `${sessionPath}/web-resources`, {
      url: 'https://cdn.example.com/a.txt',
      content_base64: contentBase64,
    });

  const registrations = [await register('YWJj'), await register('YQ=='), await register('YQ')];

  assertEquals(
    registrations.map(({ status, body }) => [status, body.content_length]),
    [[201, 3], [201, 1], [201, 1]],
    'Expected padded and unpadded base64 decoded to their bytes',
  );
});

Deno.test('Web resource content that is not base64 is an issue of its field', async () => {
  const { api, sessionPath } = await createTestSession();

  const refusal = await requestJson<ControlErrorBody>(
    api,
    'POST',
    `${sessionPath}/web-resources`,
    { url: 'https://cdn.example.com/a.txt', content_base64: 'not base64!' },
  );

  assertEquals(
    {
      status: refusal.status,
      reason: refusal.body.reason,
      issues: refusal.body.issues?.map(({ source, path, code }) => ({ source, path, code })),
    },
    {
      status: 400,
      reason: 'invalid_request',
      issues: [{ source: 'body', path: ['content_base64'], code: 'invalid_value' }],
    },
    'Expected the content reported at its field',
  );
});
