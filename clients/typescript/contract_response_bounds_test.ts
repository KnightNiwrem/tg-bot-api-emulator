/**
 * The client refuses responses that break the bounds the emulator's responses always meet, which
 * the contracts declare: non-empty texts and positive dates and IDs.
 */
import { assertEquals, assertRejects } from '@std/assert';

import { readBotActivityContract } from '../../control_contracts/bot_activity.ts';
import {
  createSupergroupContract,
  getSupergroupInviteLinksContract,
} from '../../control_contracts/supergroups.ts';
import { callJsonOperation, type ControlOperationTransport } from './control_operation_caller.ts';
import { EmulationClientError } from './emulation_client_error.ts';

function transportAnswering(status: number, body: unknown): ControlOperationTransport {
  return {
    serverRoot: new URL('http://emulator.example/'),
    fetch: () => Promise.resolve(Response.json(body, { status })),
  };
}

function botActivityPage(entry: Record<string, unknown>) {
  return { entries: [entry], head_position: 1 };
}

const call = {
  position: 1,
  kind: 'bot_api_call',
  bot_id: 1,
  method: 'sendMessage',
  requested_method: 'sendMessage',
  via: 'http',
  parameters: {},
  uploaded_files: [],
  answer: { ok: true, result: true },
};

const failedAttempt = {
  position: 1,
  kind: 'webhook_attempt_failed',
  bot_id: 1,
  update_id: 1,
  webhook_attempt_id: 1,
  failure: { reason: 'timed_out', error_message: 'Read timeout expired' },
  retry_delay_seconds: 0,
};

const inviteLink = {
  invite_link: 'https://t.me/+ABCDEFGHIJKLMNOP',
  creator_user_id: 1,
  member_count: 0,
  pending_join_request_count: 0,
  creates_join_request: false,
  is_primary: true,
  is_expired: false,
  is_revoked: false,
};

Deno.test('Bot activity entries with an empty method or error message are refused', async () => {
  const readActivity = (body: unknown) =>
    callJsonOperation(transportAnswering(200, body), readBotActivityContract, {
      params: { sessionId: 'session' },
      query: {},
    });

  for (
    const entry of [
      { ...call, method: '' },
      { ...call, requested_method: '' },
      { ...failedAttempt, failure: { reason: 'timed_out', error_message: '' } },
      { ...failedAttempt, failure: { reason: 'http_error', status_code: 500, error_message: '' } },
    ]
  ) {
    await assertRejects(
      () => readActivity(botActivityPage(entry)),
      EmulationClientError,
      'does not match its contract',
    );
  }
  const { entries } = await readActivity({ entries: [call, failedAttempt], head_position: 2 });
  assertEquals(entries.length, 2, 'Expected entries within their bounds read');
});

Deno.test('A supergroup with an empty title, username or description is refused', async () => {
  const createSupergroup = (supergroup: Record<string, unknown>) =>
    callJsonOperation(transportAnswering(201, { supergroup }), createSupergroupContract, {
      params: { sessionId: 'session', accountId: 1 },
      body: { title: 'Team' },
    });
  const supergroup = { id: -1_000_000_000_001, type: 'supergroup', title: 'Team' };

  for (
    const refused of [
      { ...supergroup, title: '' },
      { ...supergroup, username: '' },
      { ...supergroup, description: '' },
    ]
  ) {
    await assertRejects(
      () => createSupergroup(refused),
      EmulationClientError,
      'does not match its contract',
    );
  }
  assertEquals((await createSupergroup(supergroup)).supergroup.title, 'Team');
});

Deno.test('An invite link whose expiry date is not positive is refused', async () => {
  const readInviteLinks = (link: Record<string, unknown>) =>
    callJsonOperation(
      transportAnswering(200, { invite_links: [link] }),
      getSupergroupInviteLinksContract,
      { params: { sessionId: 'session', accountId: 1, chatId: -1_000_000_000_001 } },
    );

  for (const expireDate of [0, -1]) {
    await assertRejects(
      () => readInviteLinks({ ...inviteLink, expire_date: expireDate }),
      EmulationClientError,
      'does not match its contract',
    );
  }
  const { invite_links } = await readInviteLinks({ ...inviteLink, expire_date: 1_700_000_000 });
  assertEquals(invite_links[0]?.expire_date, 1_700_000_000);
});
