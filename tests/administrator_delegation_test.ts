import {
  type AdministratorMembership,
  canEditSupergroupAdministrator,
  type ChatMembership,
  grantSupergroupAdministratorRights,
  isAdministratorPromotedBy,
  type SupergroupAdministratorRight,
} from '../src/types/chat_membership.ts';

const OWNER_ID = 1;
const DELEGATING_BOT_ID = 2;
const DELEGATE_ID = 3;
const DELEGATES_APPOINTEE_ID = 4;
const OTHER_BOT_ID = 5;
const MEMBER_ID = 6;

function administrator(
  promotedById: number,
  rights: readonly SupergroupAdministratorRight[],
): AdministratorMembership {
  return {
    status: 'administrator',
    rights: grantSupergroupAdministratorRights(rights),
    promotedById,
  };
}

/**
 * A supergroup where the owner promoted a bot that may promote, the bot promoted a delegate that
 * may promote too, and the delegate promoted an appointee; the owner also promoted another bot
 * that may promote.
 */
function createDelegationChain(): Map<number, ChatMembership> {
  return new Map<number, ChatMembership>([
    [OWNER_ID, { status: 'owner' }],
    [DELEGATING_BOT_ID, administrator(OWNER_ID, ['can_promote_members'])],
    [DELEGATE_ID, administrator(DELEGATING_BOT_ID, ['can_promote_members'])],
    [DELEGATES_APPOINTEE_ID, administrator(DELEGATE_ID, ['can_delete_messages'])],
    [OTHER_BOT_ID, administrator(OWNER_ID, ['can_promote_members'])],
    [MEMBER_ID, { status: 'member' }],
  ]);
}

function canEdit(
  memberships: ReadonlyMap<number, ChatMembership>,
  editorId: number,
  administratorId: number,
): boolean {
  const membership = memberships.get(administratorId);
  if (membership?.status !== 'administrator') {
    throw new Error(`User ${administratorId} is no administrator`);
  }
  return canEditSupergroupAdministrator(
    (userId) => memberships.get(userId),
    editorId,
    membership,
  );
}

function expectEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}

Deno.test('administrators edit those they promoted, directly or indirectly, and the owner edits all', () => {
  const memberships = createDelegationChain();
  const editableBy = (editorId: number) =>
    [DELEGATING_BOT_ID, DELEGATE_ID, DELEGATES_APPOINTEE_ID, OTHER_BOT_ID].filter((
      administratorId,
    ) => canEdit(memberships, editorId, administratorId));

  expectEqual(
    editableBy(OWNER_ID),
    [DELEGATING_BOT_ID, DELEGATE_ID, DELEGATES_APPOINTEE_ID, OTHER_BOT_ID],
    'Expected the owner to edit every administrator',
  );
  expectEqual(
    editableBy(DELEGATING_BOT_ID),
    [DELEGATE_ID, DELEGATES_APPOINTEE_ID],
    'Expected the bot to edit its delegate and the delegate appointee, but neither itself nor its peer',
  );
  expectEqual(editableBy(DELEGATE_ID), [DELEGATES_APPOINTEE_ID], 'Expected the delegate edits');
  expectEqual(editableBy(DELEGATES_APPOINTEE_ID), [], 'Expected an appointee without the right');
  expectEqual(editableBy(OTHER_BOT_ID), [], 'Expected a peer to edit nobody of another chain');
  expectEqual(editableBy(MEMBER_ID), [], 'Expected a plain member to edit nobody');
});

Deno.test('editing an administrator needs the right to promote, though the chain runs through others', () => {
  const memberships = createDelegationChain();
  // The owner takes the delegate's right to promote; the delegate's appointee stays in the chain
  // of the bot that promoted the delegate.
  memberships.set(DELEGATE_ID, administrator(DELEGATING_BOT_ID, ['can_invite_users']));
  memberships.set(DELEGATING_BOT_ID, administrator(OWNER_ID, ['can_invite_users']));

  expectEqual(
    [
      canEdit(memberships, DELEGATE_ID, DELEGATES_APPOINTEE_ID),
      canEdit(memberships, DELEGATING_BOT_ID, DELEGATE_ID),
      isAdministratorPromotedBy(
        (userId) => memberships.get(userId),
        DELEGATING_BOT_ID,
        administrator(DELEGATE_ID, []),
      ),
    ],
    [false, false, true],
    'Expected only the right to promote to be missing',
  );
});

Deno.test('a chain broken by a demoted promoter leaves its administrators to the owner', () => {
  const memberships = createDelegationChain();
  memberships.set(DELEGATE_ID, { status: 'member' });

  expectEqual(
    [
      canEdit(memberships, DELEGATING_BOT_ID, DELEGATES_APPOINTEE_ID),
      canEdit(memberships, OWNER_ID, DELEGATES_APPOINTEE_ID),
    ],
    [false, true],
    'Expected only the owner to edit the appointee of a demoted delegate',
  );

  memberships.delete(DELEGATE_ID);
  expectEqual(
    canEdit(memberships, DELEGATING_BOT_ID, DELEGATES_APPOINTEE_ID),
    false,
    'Expected a delegate that left to break the chain too',
  );
});

Deno.test('promotions that form a cycle are refused as a broken invariant', () => {
  const memberships = new Map<number, ChatMembership>([
    [OWNER_ID, { status: 'owner' }],
    [DELEGATING_BOT_ID, administrator(DELEGATE_ID, ['can_promote_members'])],
    [DELEGATE_ID, administrator(DELEGATES_APPOINTEE_ID, ['can_promote_members'])],
    [DELEGATES_APPOINTEE_ID, administrator(DELEGATE_ID, ['can_promote_members'])],
  ]);

  let failure: unknown;
  try {
    canEdit(memberships, DELEGATING_BOT_ID, DELEGATE_ID);
  } catch (error) {
    failure = error;
  }
  if (!(failure instanceof Error) || !failure.message.includes('cycle')) {
    throw new Error(`Expected the cycle to be reported, received ${String(failure)}`);
  }
});
