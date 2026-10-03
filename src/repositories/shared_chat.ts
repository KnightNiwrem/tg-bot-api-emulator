import type {
  AdministratorTenureId,
  ChatMembership,
  ChatMemberStatus,
  FormerChatMemberStatus,
} from '../types/chat_membership.ts';
import type { ChatJoinRequest } from '../types/chat_join_request.ts';
import {
  ALL_CHAT_PERMISSIONS,
  type ChatPermissions,
  isSameChatPermissions,
} from '../types/chat_permissions.ts';
import type { BasicGroup, Channel, SharedChat, Supergroup } from '../types/virtual_chat.ts';
import type { CanonicalMessageId } from '../types/virtual_message.ts';

export type SharedChatRegistrationFailureReason = 'chat_id_taken';

export type BasicGroupRegistrationFailureReason =
  | SharedChatRegistrationFailureReason
  | 'initial_members_not_unique';

export type SharedChatRegistrationResult =
  | { readonly registered: true }
  | {
    readonly registered: false;
    readonly reason: SharedChatRegistrationFailureReason;
  };

export type BasicGroupRegistrationResult =
  | { readonly registered: true }
  | {
    readonly registered: false;
    readonly reason: BasicGroupRegistrationFailureReason;
  };

export type ChatMemberAdditionFailureReason =
  | 'chat_not_found'
  | 'member_already_present';

export type ChatMemberAdditionResult =
  | { readonly added: true }
  | {
    readonly added: false;
    readonly reason: ChatMemberAdditionFailureReason;
  };

export type ChatMemberRemovalFailureReason = 'chat_not_found' | 'not_a_member';

export type ChatMemberRemovalResult =
  | { readonly removed: true }
  | {
    readonly removed: false;
    readonly reason: ChatMemberRemovalFailureReason;
  };

/** The standing a user joins a chat with: a member, or restricted if it was restricted before. */
export type JoiningMemberStatus = Extract<
  ChatMembership,
  { readonly status: 'member' | 'restricted' }
>;

/** The standing of a member that is not the owner, which the owner can change. */
export type NonOwnerMemberStatus = Exclude<ChatMembership, { readonly status: 'owner' }>;

export type ChatMemberStatusUpdateFailureReason =
  | 'chat_not_found'
  | 'not_a_member'
  | 'member_is_owner';

export type ChatMemberStatusUpdateResult =
  | { readonly updated: true }
  | {
    readonly updated: false;
    readonly reason: ChatMemberStatusUpdateFailureReason;
  };

export type CustomTitleUpdateResult =
  | { readonly updated: true }
  | {
    readonly updated: false;
    readonly reason: 'chat_not_found' | 'not_a_member' | 'not_an_administrator';
  };

export type FormerMemberStatusUpdateResult =
  | { readonly updated: true }
  | {
    readonly updated: false;
    readonly reason: 'chat_not_found' | 'member_present';
  };

/**
 * Stores shared chats together with their memberships, so that a registered chat always has
 * exactly one owner, who stays a member. It remembers how each former member's membership ended,
 * including bans of users that never joined, until the user is added again, and the invite link
 * each current membership began with, which the membership ending forgets. It also keeps the
 * pending join requests of users outside each chat that may still join: a user's request ends
 * when the user joins, whichever way, or is banned.
 */
export class SharedChatRepository {
  readonly #sharedChatsById = new Map<number, SharedChat>();
  readonly #sharedChatMembershipsByChatId = new Map<number, Map<number, ChatMembership>>();
  readonly #formerMemberStatusesByChatId = new Map<number, Map<number, FormerChatMemberStatus>>();
  /** Keyed by chat ID, then by the ID of a member that joined through an invite link. */
  readonly #joiningInviteLinkUrlsByChatId = new Map<number, Map<number, string>>();
  /** Keyed by chat ID, then by the requester's ID, in the order the requests were sent. */
  readonly #pendingJoinRequestsByChatId = new Map<number, Map<number, ChatJoinRequest>>();
  /** Keyed by chat ID, then by the ID of the account whose client shows the reply interface. */
  readonly #replyInterfaceMessageIdsByChatId = new Map<number, Map<number, CanonicalMessageId>>();
  #lastAdministratorTenureId: AdministratorTenureId = 0;

  /** Issues the identifier of an administrator tenure that starts, greater than every earlier one. */
  issueAdministratorTenureId(): AdministratorTenureId {
    this.#lastAdministratorTenureId += 1;
    return this.#lastAdministratorTenureId;
  }

  registerBasicGroup(
    group: BasicGroup,
    ownerAccountId: number,
    initialMemberIds: readonly number[],
  ): BasicGroupRegistrationResult {
    if (this.#sharedChatsById.has(group.id)) {
      return { registered: false, reason: 'chat_id_taken' };
    }

    const membershipsByIdentityId = new Map<number, ChatMembership>([
      [ownerAccountId, { status: 'owner' }],
    ]);
    for (const initialMemberId of initialMemberIds) {
      if (membershipsByIdentityId.has(initialMemberId)) {
        return { registered: false, reason: 'initial_members_not_unique' };
      }
      membershipsByIdentityId.set(initialMemberId, { status: 'member' });
    }

    this.#storeSharedChat(group, membershipsByIdentityId);
    return { registered: true };
  }

  registerSupergroup(
    supergroup: Supergroup,
    ownerAccountId: number,
  ): SharedChatRegistrationResult {
    return this.#registerOwnerOnlyChat(supergroup, ownerAccountId);
  }

  registerChannel(
    channel: Channel,
    ownerAccountId: number,
  ): SharedChatRegistrationResult {
    return this.#registerOwnerOnlyChat(channel, ownerAccountId);
  }

  #registerOwnerOnlyChat(
    chat: Supergroup | Channel,
    ownerAccountId: number,
  ): SharedChatRegistrationResult {
    if (this.#sharedChatsById.has(chat.id)) {
      return { registered: false, reason: 'chat_id_taken' };
    }

    this.#storeSharedChat(
      chat,
      new Map([
        [ownerAccountId, { status: 'owner' }],
      ]),
    );
    return { registered: true };
  }

  #storeSharedChat(
    chat: SharedChat,
    membershipsByIdentityId: Map<number, ChatMembership>,
  ): void {
    this.#sharedChatsById.set(chat.id, chat);
    this.#sharedChatMembershipsByChatId.set(chat.id, membershipsByIdentityId);
    this.#formerMemberStatusesByChatId.set(chat.id, new Map());
  }

  getSharedChat(id: number): SharedChat | undefined {
    return this.#sharedChatsById.get(id);
  }

  getChatMembership(
    chatId: number,
    identityId: number,
  ): ChatMembership | undefined {
    return this.#sharedChatMembershipsByChatId.get(chatId)?.get(identityId);
  }

  /** Returns how a former member's membership ended; `undefined` for a member or a stranger. */
  getFormerMemberStatus(chatId: number, identityId: number): FormerChatMemberStatus | undefined {
    return this.#formerMemberStatusesByChatId.get(chatId)?.get(identityId);
  }

  /** Returns the identities of the chat's members, owner included, in the order they joined. */
  getChatMemberIds(chatId: number): readonly number[] {
    return [...(this.#sharedChatMembershipsByChatId.get(chatId)?.keys() ?? [])];
  }

  /**
   * Adds a user to a chat as a member, or as a restricted member that keeps its restriction,
   * remembering the invite link it joined through, if any, for as long as the membership lasts.
   */
  addChatMember(
    chatId: number,
    memberId: number,
    membership: JoiningMemberStatus = { status: 'member' },
    joiningInviteLinkUrl?: string,
  ): ChatMemberAdditionResult {
    const membershipsByIdentityId = this.#sharedChatMembershipsByChatId.get(chatId);
    if (membershipsByIdentityId === undefined) {
      return { added: false, reason: 'chat_not_found' };
    }
    if (membershipsByIdentityId.has(memberId)) {
      return { added: false, reason: 'member_already_present' };
    }

    assertRestrictionWithholdsPermission(chatId, memberId, membership);
    membershipsByIdentityId.set(memberId, membership);
    this.#formerMemberStatusesByChatId.get(chatId)?.delete(memberId);
    this.#pendingJoinRequestsByChatId.get(chatId)?.delete(memberId);
    if (joiningInviteLinkUrl !== undefined) {
      const linkUrlsByMemberId = this.#joiningInviteLinkUrlsByChatId.get(chatId) ??
        new Map<number, string>();
      linkUrlsByMemberId.set(memberId, joiningInviteLinkUrl);
      this.#joiningInviteLinkUrlsByChatId.set(chatId, linkUrlsByMemberId);
    }
    return { added: true };
  }

  /**
   * Stores a user's pending request to join a chat. The user must be neither a member nor banned,
   * and have no pending request there.
   */
  addJoinRequest(request: ChatJoinRequest): void {
    const { chatId, userId } = request;
    if (!this.#sharedChatsById.has(chatId)) {
      throw new Error(`Chat ${chatId} does not exist`);
    }
    if (
      this.getChatMembership(chatId, userId) !== undefined ||
      this.getFormerMemberStatus(chatId, userId)?.status === 'kicked'
    ) {
      throw new Error(`User ${userId} of chat ${chatId} cannot request to join it`);
    }
    const requestsByUserId = this.#pendingJoinRequestsByChatId.get(chatId) ??
      new Map<number, ChatJoinRequest>();
    if (requestsByUserId.has(userId)) {
      throw new Error(`User ${userId} already requested to join chat ${chatId}`);
    }
    requestsByUserId.set(userId, request);
    this.#pendingJoinRequestsByChatId.set(chatId, requestsByUserId);
  }

  /** Returns a user's pending request to join a chat; `undefined` for none. */
  getJoinRequest(chatId: number, userId: number): ChatJoinRequest | undefined {
    return this.#pendingJoinRequestsByChatId.get(chatId)?.get(userId);
  }

  /** Returns a chat's pending join requests in the order they were sent. */
  listJoinRequests(chatId: number): readonly ChatJoinRequest[] {
    return [...(this.#pendingJoinRequestsByChatId.get(chatId)?.values() ?? [])];
  }

  /** Ends a user's pending request to join a chat, as a decline does; returns false for none. */
  removeJoinRequest(chatId: number, userId: number): boolean {
    return this.#pendingJoinRequestsByChatId.get(chatId)?.delete(userId) ?? false;
  }

  /** Counts a chat's pending join requests sent through an invite link. */
  countJoinRequestsByInviteLink(chatId: number, inviteLinkUrl: string): number {
    return this.listJoinRequests(chatId)
      .filter((request) => request.inviteLinkUrl === inviteLinkUrl).length;
  }

  /** Counts the current members of a chat whose membership began with an invite link. */
  countMembersJoinedByInviteLink(chatId: number, inviteLinkUrl: string): number {
    return [...(this.#joiningInviteLinkUrlsByChatId.get(chatId)?.values() ?? [])]
      .filter((url) => url === inviteLinkUrl).length;
  }

  /**
   * Changes a supergroup's title and description, whichever `info` gives, where an empty
   * description removes it; returns false for an unknown supergroup.
   */
  updateSupergroupInfo(
    chatId: number,
    info: { readonly title?: string; readonly description?: string },
  ): boolean {
    const chat = this.#sharedChatsById.get(chatId);
    if (chat?.kind !== 'supergroup') {
      return false;
    }
    const { description: _, ...chatWithoutDescription } = chat;
    const description = info.description ?? chat.description;
    this.#sharedChatsById.set(chatId, {
      ...chatWithoutDescription,
      title: info.title ?? chat.title,
      ...(description === undefined || description.length === 0 ? {} : { description }),
    });
    return true;
  }

  /** Sets whether a supergroup protects all its content; returns false for an unknown supergroup. */
  updateSupergroupContentProtection(chatId: number, hasProtectedContent: boolean): boolean {
    const chat = this.#sharedChatsById.get(chatId);
    if (chat?.kind !== 'supergroup') {
      return false;
    }
    this.#sharedChatsById.set(chatId, { ...chat, hasProtectedContent });
    return true;
  }

  /** Sets what a supergroup's members may do by default; returns false for an unknown supergroup. */
  updateSupergroupDefaultPermissions(chatId: number, defaultPermissions: ChatPermissions): boolean {
    const chat = this.#sharedChatsById.get(chatId);
    if (chat?.kind !== 'supergroup') {
      return false;
    }
    this.#sharedChatsById.set(chatId, { ...chat, defaultPermissions });
    return true;
  }

  /**
   * Promotes a member to administrator, changes its rights, restricts it, or makes it a plain
   * member; never the owner.
   */
  updateChatMemberStatus(
    chatId: number,
    memberId: number,
    status: NonOwnerMemberStatus,
  ): ChatMemberStatusUpdateResult {
    const membershipsByIdentityId = this.#sharedChatMembershipsByChatId.get(chatId);
    if (membershipsByIdentityId === undefined) {
      return { updated: false, reason: 'chat_not_found' };
    }
    const membership = membershipsByIdentityId.get(memberId);
    if (membership === undefined) {
      return { updated: false, reason: 'not_a_member' };
    }
    if (membership.status === 'owner') {
      return { updated: false, reason: 'member_is_owner' };
    }

    assertRestrictionWithholdsPermission(chatId, memberId, status);
    membershipsByIdentityId.set(memberId, status);
    return { updated: true };
  }

  /** Sets the custom title of the owner or an administrator; `undefined` removes it. */
  setCustomTitle(
    chatId: number,
    memberId: number,
    customTitle: string | undefined,
  ): CustomTitleUpdateResult {
    const membershipsByIdentityId = this.#sharedChatMembershipsByChatId.get(chatId);
    if (membershipsByIdentityId === undefined) {
      return { updated: false, reason: 'chat_not_found' };
    }
    const membership = membershipsByIdentityId.get(memberId);
    if (membership === undefined) {
      return { updated: false, reason: 'not_a_member' };
    }
    if (membership.status !== 'owner' && membership.status !== 'administrator') {
      return { updated: false, reason: 'not_an_administrator' };
    }

    const { customTitle: _, ...untitledMembership } = membership;
    membershipsByIdentityId.set(
      memberId,
      customTitle === undefined ? untitledMembership : { ...untitledMembership, customTitle },
    );
    return { updated: true };
  }

  /**
   * Returns the message whose reply interface a member's client shows in the chat, as TDLib's
   * `reply_markup_message_id` identifies it, or `undefined` when it shows none.
   */
  getReplyInterfaceMessageId(chatId: number, accountId: number): CanonicalMessageId | undefined {
    return this.#replyInterfaceMessageIdsByChatId.get(chatId)?.get(accountId);
  }

  /** Records the message whose reply interface a member's client shows; `undefined` shows none. */
  setReplyInterfaceMessageId(
    chatId: number,
    accountId: number,
    messageId: CanonicalMessageId | undefined,
  ): void {
    if (this.#sharedChatsById.get(chatId) === undefined) {
      throw new Error(`Chat ${chatId} does not exist`);
    }
    const messageIdsByAccountId = this.#replyInterfaceMessageIdsByChatId.get(chatId) ??
      new Map<number, CanonicalMessageId>();
    if (messageId === undefined) {
      messageIdsByAccountId.delete(accountId);
    } else {
      messageIdsByAccountId.set(accountId, messageId);
    }
    this.#replyInterfaceMessageIdsByChatId.set(chatId, messageIdsByAccountId);
  }

  /** Ends a membership, remembering how it ended. */
  removeChatMember(
    chatId: number,
    memberId: number,
    formerStatus: FormerChatMemberStatus,
  ): ChatMemberRemovalResult {
    assertRestrictionWithholdsPermission(chatId, memberId, formerStatus);
    const membershipsByIdentityId = this.#sharedChatMembershipsByChatId.get(chatId);
    const formerMemberStatuses = this.#formerMemberStatusesByChatId.get(chatId);
    if (membershipsByIdentityId === undefined || formerMemberStatuses === undefined) {
      return { removed: false, reason: 'chat_not_found' };
    }
    if (!membershipsByIdentityId.delete(memberId)) {
      return { removed: false, reason: 'not_a_member' };
    }

    this.#joiningInviteLinkUrlsByChatId.get(chatId)?.delete(memberId);
    formerMemberStatuses.set(memberId, formerStatus);
    return { removed: true };
  }

  /**
   * Bans or restricts a user that is not a member, or lifts its ban or restriction, which leaves
   * it as having left.
   */
  updateFormerMemberStatus(
    chatId: number,
    identityId: number,
    formerStatus: FormerChatMemberStatus,
  ): FormerMemberStatusUpdateResult {
    const membershipsByIdentityId = this.#sharedChatMembershipsByChatId.get(chatId);
    const formerMemberStatuses = this.#formerMemberStatusesByChatId.get(chatId);
    if (membershipsByIdentityId === undefined || formerMemberStatuses === undefined) {
      return { updated: false, reason: 'chat_not_found' };
    }
    if (membershipsByIdentityId.has(identityId)) {
      return { updated: false, reason: 'member_present' };
    }

    assertRestrictionWithholdsPermission(chatId, identityId, formerStatus);
    formerMemberStatuses.set(identityId, formerStatus);
    if (formerStatus.status === 'kicked') {
      this.#pendingJoinRequestsByChatId.get(chatId)?.delete(identityId);
    }
    return { updated: true };
  }
}

/**
 * Refuses to store a restriction that keeps every permission, which TDLib's
 * `DialogParticipantStatus::Restricted` makes a plain member, or a user that left, instead.
 */
function assertRestrictionWithholdsPermission(
  chatId: number,
  userId: number,
  status: ChatMemberStatus,
): void {
  if (
    status.status === 'restricted' &&
    isSameChatPermissions(status.permissions, ALL_CHAT_PERMISSIONS)
  ) {
    throw new Error(
      `User ${userId} of chat ${chatId} cannot be restricted while keeping every permission`,
    );
  }
}
