/**
 * The client reads a supergroup's administrators as their contract declares them, refusing a
 * response whose user IDs are no Telegram user IDs.
 */
import { assertEquals, assertRejects } from '@std/assert';

import {
  expireSupergroupMemberRestrictionContract,
  getSupergroupAdministratorsContract,
} from '../../src/api/contracts/supergroup_administration.ts';
import {
  callJsonAction,
  callJsonOperation,
  type ControlOperationTransport,
} from './control_operation_caller.ts';
import { EmulationClientError } from './emulation_client_error.ts';
import { TEST_ACTION_RECEIPT_HEADERS } from './test_support/action_receipt_headers.ts';

const ADMINISTRATORS_PARAMS = {
  sessionId: 'session',
  accountId: 1,
  chatId: -1_000_000_000_001,
} as const;

function transportAnswering(body: unknown): ControlOperationTransport {
  return {
    serverRoot: new URL('http://emulator.example/'),
    fetch: () => Promise.resolve(Response.json(body, { headers: TEST_ACTION_RECEIPT_HEADERS })),
  };
}

function administratorsWith(ownerId: number, administrator: Record<string, number>) {
  return {
    administrators: [
      { user_id: ownerId, status: 'owner' },
      {
        user_id: 2,
        status: 'administrator',
        rights: Object.fromEntries(
          [
            'can_manage_chat',
            'can_change_info',
            'can_delete_messages',
            'can_invite_users',
            'can_restrict_members',
            'can_pin_messages',
            'can_manage_topics',
            'can_promote_members',
            'can_manage_video_chats',
            'can_post_stories',
            'can_edit_stories',
            'can_delete_stories',
            'can_manage_tags',
            'can_send_welcome_messages',
          ].map((right) => [right, false]),
        ),
        promoted_by_user_id: 1,
        can_be_edited: true,
        ...administrator,
      },
    ],
  };
}

Deno.test('Administrators whose user IDs are no Telegram user IDs are refused', async () => {
  for (
    const body of [
      administratorsWith(0, {}),
      administratorsWith(-5, {}),
      administratorsWith(1, { user_id: 0 }),
      administratorsWith(1, { promoted_by_user_id: 0 }),
    ]
  ) {
    await assertRejects(
      () =>
        callJsonOperation(transportAnswering(body), getSupergroupAdministratorsContract, {
          params: ADMINISTRATORS_PARAMS,
        }),
      EmulationClientError,
      'does not match its contract',
    );
  }

  const { administrators } = await callJsonOperation(
    transportAnswering(administratorsWith(1, {})),
    getSupergroupAdministratorsContract,
    { params: ADMINISTRATORS_PARAMS },
  );
  assertEquals(
    administrators.map(({ user_id }) => user_id),
    [1, 2],
    'Expected valid user IDs read',
  );
});

Deno.test('An expired restriction whose user ID is no Telegram user ID is refused', async () => {
  const params = { sessionId: 'session', chatId: -1_000_000_000_001, userId: 1 };
  const chatMember = (id: number) => ({
    chat_member: { user: { id, is_bot: false, first_name: 'Ada' }, status: 'member' },
  });

  await assertRejects(
    () =>
      callJsonAction(
        transportAnswering(chatMember(0)),
        expireSupergroupMemberRestrictionContract,
        { params },
      ),
    EmulationClientError,
    'does not match its contract',
  );
  const { result: { chat_member } } = await callJsonAction(
    transportAnswering(chatMember(1)),
    expireSupergroupMemberRestrictionContract,
    { params },
  );
  assertEquals(chat_member.status, 'member', 'Expected a valid standing read');
});
