/**
 * The input of the supergroup administration routes: IDs written as decimal integers, and rights
 * and permissions named only by the Bot API's names.
 */
import { assertEquals } from '@std/assert';

import type { ControlErrorBody } from '../../clients/typescript/mod.ts';
import { requestJson } from '../support/emulation_api.ts';
import { createSupergroupFixture } from '../support/http_fixtures.ts';

Deno.test('Administration paths take IDs written only in decimal digits', async () => {
  await using fixture = await createSupergroupFixture();
  const { api, sessionPath, owner, member, supergroup, supergroupPath } = fixture;

  const refusals = await Promise.all([
    requestJson<ControlErrorBody>(
      api,
      'PUT',
      `${supergroupPath(owner.id)}/administrators/${member.id}.0`,
      { can_pin_messages: true },
    ),
    requestJson<ControlErrorBody>(
      api,
      'POST',
      `${sessionPath}/supergroups/${supergroup.id}/restrictions/0x${member.id.toString(16)}/expiry`,
    ),
  ]);

  assertEquals(
    refusals.map(({ status, body }) => ({
      status,
      issues: body.issues?.map(({ source, path, code }) => ({ source, path, code })),
    })),
    [
      { status: 400, issues: [{ source: 'path', path: ['userId'], code: 'invalid_type' }] },
      { status: 400, issues: [{ source: 'path', path: ['userId'], code: 'invalid_type' }] },
    ],
    'Expected each ID that is not decimal digits to be an issue of its path parameter',
  );
});

Deno.test('A right or permission the Bot API does not name is an unknown field', async () => {
  await using fixture = await createSupergroupFixture();
  const { api, owner, member, supergroupPath } = fixture;

  const promotion = await requestJson<ControlErrorBody>(
    api,
    'PUT',
    `${supergroupPath(owner.id)}/administrators/${member.id}`,
    { can_pin_messages: true, can_fly: true },
  );
  const permissions = await requestJson<ControlErrorBody>(
    api,
    'PUT',
    `${supergroupPath(owner.id)}/permissions`,
    { permissions: { can_send_messages: true, can_send_media_messages: true } },
  );

  assertEquals(
    [promotion, permissions].map(({ status, body }) => ({
      status,
      issues: body.issues?.map(({ path, code }) => ({ path, code })),
    })),
    [
      { status: 400, issues: [{ path: ['can_fly'], code: 'unknown_field' }] },
      {
        status: 400,
        issues: [{ path: ['permissions', 'can_send_media_messages'], code: 'unknown_field' }],
      },
    ],
    'Expected each name the Bot API does not give a right or permission reported where it is',
  );
});
