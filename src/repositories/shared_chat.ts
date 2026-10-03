import type { ChatMembership, FormerChatMemberStatus } from '../types/chat_membership.ts';
import type { ChatPermissions } from '../types/chat_permissions.ts';
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
 * including bans of users that never joined, until the user is added again.
 */
export class SharedChatRepository {
  readonly #sharedChatsById = new Map<number, SharedChat>();
  readonly #sharedChatMembershipsByChatId = new Map<number, Map<number, ChatMembership>>();
  readonly #formerMemberStatusesByChatId = new Map<number, Map<number, FormerChatMemberStatus>>();
  /** Keyed by chat ID, then by the ID of the account whose client shows the reply interface. */
  readonly #replyInterfaceMessageIdsByChatId = new Map<number, Map<number, CanonicalMessageId>>();

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

  /** Adds a user to a chat as a member, or as a restricted member that keeps its restriction. */
  addChatMember(
    chatId: number,
    memberId: number,
    membership: JoiningMemberStatus = { status: 'member' },
  ): ChatMemberAdditionResult {
    const membershipsByIdentityId = this.#sharedChatMembershipsByChatId.get(chatId);
    if (membershipsByIdentityId === undefined) {
      return { added: false, reason: 'chat_not_found' };
    }
    if (membershipsByIdentityId.has(memberId)) {
      return { added: false, reason: 'member_already_present' };
    }

    membershipsByIdentityId.set(memberId, membership);
    this.#formerMemberStatusesByChatId.get(chatId)?.delete(memberId);
    return { added: true };
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
    const membershipsByIdentityId = this.#sharedChatMembershipsByChatId.get(chatId);
    const formerMemberStatuses = this.#formerMemberStatusesByChatId.get(chatId);
    if (membershipsByIdentityId === undefined || formerMemberStatuses === undefined) {
      return { removed: false, reason: 'chat_not_found' };
    }
    if (!membershipsByIdentityId.delete(memberId)) {
      return { removed: false, reason: 'not_a_member' };
    }

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

    formerMemberStatuses.set(identityId, formerStatus);
    return { updated: true };
  }
}
