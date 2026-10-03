import {
  type AdministratorMembership,
  type AdministratorTenureId,
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

/**
 * An administrator in its tenure `tenureId`, promoted by the owner, or by an administrator in that
 * administrator's tenure `promoterTenureId`.
 */
function administrator(
  tenureId: AdministratorTenureId,
  rights: readonly SupergroupAdministratorRight[],
  promotion: { readonly promotedById: number; readonly promoterTenureId?: AdministratorTenureId },
): AdministratorMembership {
  return {
    status: 'administrator',
    rights: grantSupergroupAdministratorRights(rights),
    tenureId,
    ...promotion,
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
    [
      DELEGATING_BOT_ID,
      administrator(1, ['can_promote_members'], { promotedById: OWNER_ID }),
    ],
    [
      DELEGATE_ID,
      administrator(2, ['can_promote_members'], {
        promotedById: DELEGATING_BOT_ID,
        promoterTenureId: 1,
      }),
    ],
    [
      DELEGATES_APPOINTEE_ID,
      administrator(3, ['can_delete_messages'], { promotedById: DELEGATE_ID, promoterTenureId: 2 }),
    ],
    [OTHER_BOT_ID, administrator(4, ['can_promote_members'], { promotedById: OWNER_ID })],
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
  return canEditSupergroupAdministrator((userId) => memberships.get(userId), editorId, {
    userId: administratorId,
    membership,
  });
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
  // The owner takes the right to promote from the bot and its delegate, keeping their tenures; the
  // delegate's appointee stays in the bot's chain.
  memberships.set(
    DELEGATE_ID,
    administrator(2, ['can_invite_users'], {
      promotedById: DELEGATING_BOT_ID,
      promoterTenureId: 1,
    }),
  );
  memberships.set(
    DELEGATING_BOT_ID,
    administrator(1, ['can_invite_users'], { promotedById: OWNER_ID }),
  );
  const appointee = memberships.get(DELEGATES_APPOINTEE_ID);
  if (appointee?.status !== 'administrator') {
    throw new Error('Expected the appointee to be an administrator');
  }

  expectEqual(
    [
      canEdit(memberships, DELEGATE_ID, DELEGATES_APPOINTEE_ID),
      canEdit(memberships, DELEGATING_BOT_ID, DELEGATE_ID),
      isAdministratorPromotedBy((userId) => memberships.get(userId), DELEGATING_BOT_ID, {
        userId: DELEGATES_APPOINTEE_ID,
        membership: appointee,
      }),
    ],
    [false, false, true],
    'Expected only the right to promote to be missing',
  );
});

Deno.test('a promoter whose tenure ended no longer stands above its appointees, even once promoted again', () => {
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

  // Promoted again, the delegate starts a new tenure, which its old appointee's link does not name.
  memberships.set(
    DELEGATE_ID,
    administrator(5, ['can_promote_members'], {
      promotedById: DELEGATING_BOT_ID,
      promoterTenureId: 1,
    }),
  );
  expectEqual(
    [
      canEdit(memberships, DELEGATE_ID, DELEGATES_APPOINTEE_ID),
      canEdit(memberships, DELEGATING_BOT_ID, DELEGATES_APPOINTEE_ID),
      canEdit(memberships, DELEGATING_BOT_ID, DELEGATE_ID),
    ],
    [false, false, true],
    'Expected the old appointee to stay with the owner, and the new tenure to be editable',
  );
});

Deno.test('a demoted promoter promoted back by its own appointee forms no cycle', () => {
  // The owner promoted the bot (tenure 1), which promoted its delegate (tenure 2), then demoted
  // itself; the delegate promoted the bot again (tenure 3).
  const memberships = new Map<number, ChatMembership>([
    [OWNER_ID, { status: 'owner' }],
    [
      DELEGATE_ID,
      administrator(2, ['can_promote_members'], {
        promotedById: DELEGATING_BOT_ID,
        promoterTenureId: 1,
      }),
    ],
    [
      DELEGATING_BOT_ID,
      administrator(3, ['can_promote_members'], { promotedById: DELEGATE_ID, promoterTenureId: 2 }),
    ],
  ]);

  expectEqual(
    [
      canEdit(memberships, DELEGATE_ID, DELEGATING_BOT_ID),
      canEdit(memberships, DELEGATING_BOT_ID, DELEGATE_ID),
      canEdit(memberships, DELEGATE_ID, DELEGATE_ID),
      canEdit(memberships, DELEGATING_BOT_ID, DELEGATING_BOT_ID),
      canEdit(memberships, OWNER_ID, DELEGATE_ID),
    ],
    [true, false, false, false, true],
    'Expected only the delegate to edit the bot it promoted back, and nobody to edit itself',
  );
});

Deno.test('nobody edits itself, and no data shape makes the delegation walk fail', () => {
  // Links that count yet form cycles, and one that names its own administrator, which no
  // sequence of changes stores, still answer without failing.
  const memberships = new Map<number, ChatMembership>([
    [OWNER_ID, { status: 'owner' }],
    [
      DELEGATING_BOT_ID,
      administrator(1, ['can_promote_members'], { promotedById: DELEGATE_ID, promoterTenureId: 2 }),
    ],
    [
      DELEGATE_ID,
      administrator(2, ['can_promote_members'], {
        promotedById: DELEGATING_BOT_ID,
        promoterTenureId: 1,
      }),
    ],
    [
      DELEGATES_APPOINTEE_ID,
      administrator(3, ['can_promote_members'], {
        promotedById: DELEGATES_APPOINTEE_ID,
        promoterTenureId: 3,
      }),
    ],
    [
      OTHER_BOT_ID,
      administrator(4, ['can_promote_members'], {
        promotedById: DELEGATING_BOT_ID,
        promoterTenureId: 1,
      }),
    ],
  ]);

  expectEqual(
    [
      canEdit(memberships, DELEGATING_BOT_ID, DELEGATING_BOT_ID),
      canEdit(memberships, DELEGATE_ID, DELEGATE_ID),
      canEdit(memberships, DELEGATES_APPOINTEE_ID, DELEGATES_APPOINTEE_ID),
      canEdit(memberships, DELEGATE_ID, DELEGATING_BOT_ID),
      canEdit(memberships, DELEGATE_ID, OTHER_BOT_ID),
      canEdit(memberships, DELEGATES_APPOINTEE_ID, OTHER_BOT_ID),
    ],
    [false, false, false, true, true, false],
    'Expected no self-editing, and a walk that stops at a user it met before',
  );
});
