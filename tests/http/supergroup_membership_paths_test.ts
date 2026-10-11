/**
 * The path parameters of the supergroup membership routes: IDs written as decimal integers, and
 * invite link hashes of the form Telegram writes them.
 */
import { assertEquals } from '@std/assert';

import type { ControlErrorBody } from '../../clients/typescript/mod.ts';
import { requestJson } from '../support/emulation_api.ts';
import { createSupergroupFixture } from '../support/http_fixtures.ts';

Deno.test('Supergroup paths take IDs written only in decimal digits', async () => {
  const { api, sessionPath, owner, member, supergroup } = await createSupergroupFixture();
  const membersPath = `${sessionPath}/accounts/${owner.id}/conversations/supergroup`;

  const accepted = await api.request(`${membersPath}/${supergroup.id}/members/${member.id}`, {
    method: 'PUT',
  });
  const refusals = await Promise.all(
    [
      `${membersPath}/${supergroup.id}/members/${member.id}.0`,
      `${membersPath}/${supergroup.id}/members/1e3`,
      `${membersPath}/${supergroup.id}/members/0x10`,
      `${membersPath}/${supergroup.id}e0/members/${member.id}`,
    ].map((path) => requestJson<ControlErrorBody>(api, 'PUT', path)),
  );

  assertEquals(accepted.status, 204, 'Expected decimal IDs to address the member');
  assertEquals(
    refusals.map(({ status, body }) => ({
      status,
      issues: body.issues?.map(({ source, path, code }) => ({ source, path, code })),
    })),
    [
      { status: 400, issues: [{ source: 'path', path: ['userId'], code: 'invalid_type' }] },
      { status: 400, issues: [{ source: 'path', path: ['userId'], code: 'invalid_type' }] },
      { status: 400, issues: [{ source: 'path', path: ['userId'], code: 'invalid_type' }] },
      { status: 400, issues: [{ source: 'path', path: ['chatId'], code: 'invalid_type' }] },
    ],
    'Expected each ID that is not decimal digits to be an issue of its path parameter',
  );
});

Deno.test('An invite link expiry names the link by a hash of its form', async () => {
  const { api, sessionPath, supergroup } = await createSupergroupFixture();
  const inviteLinksPath = `${sessionPath}/supergroups/${supergroup.id}/invite-links`;

  const unknown = await requestJson<ControlErrorBody>(
    api,
    'POST',
    `${inviteLinksPath}/ABCDEFGHIJKLMNOP/expiry`,
  );
  const malformed = await requestJson<ControlErrorBody>(
    api,
    'POST',
    `${inviteLinksPath}/ABCDEFGHIJKLMNO/expiry`,
  );

  assertEquals(unknown.status, 404, 'Expected a well-formed hash no link has to be not found');
  assertEquals(unknown.body, { reason: 'invite_link_not_found' });
  assertEquals(malformed.status, 400, 'Expected a hash of 15 characters to be refused');
  assertEquals(
    malformed.body.issues?.map(({ source, path, code }) => ({ source, path, code })),
    [{ source: 'path', path: ['inviteLinkHash'], code: 'invalid_format' }],
    'Expected the hash to be an issue of its form',
  );
});
