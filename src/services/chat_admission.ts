import type { NewChatInviteLink } from '../repositories/chat_invite_link.ts';
import { cleanInputString, cleanName } from '../text_entities/input_string.ts';
import {
  type ChatInviteLink,
  MAX_INVITE_LINK_MEMBER_LIMIT,
  MAX_INVITE_LINK_NAME_LENGTH,
} from '../types/chat_invite_link.ts';
import {
  holdsSupergroupAdministratorRight,
  resolveSupergroupBotMembership,
  type SupergroupBotAccessFailureReason,
  type SupergroupMembershipLookup,
} from '../types/chat_membership.ts';
import type { ChatDomainEvent } from '../types/chat_domain_event.ts';
import type { ChatJoinRequest } from '../types/chat_join_request.ts';
import type { VirtualAccount } from '../types/virtual_account.ts';
import type { VirtualBot } from '../types/virtual_bot.ts';

export interface CreateInviteLinkAsBotInput {
  readonly creatorBotId: number;
  readonly chatId: number;
  /** The link's name as the bot specified it, before Telegram cleans it; empty for none. */
  readonly name: string;
  /** When the link stops working, which must be in the future; omitted for never. */
  readonly expiresAtUnixSeconds?: number;
  /** How many users that joined through the link may be members at once; omitted for no limit. */
  readonly memberLimit?: number;
  readonly createsJoinRequest: boolean;
}

/**
 * Why a bot cannot create an invite link, in the order the official Bot API server, TDLib's
 * `export_dialog_invite_link`, and then Telegram's servers check them.
 */
export type CreateInviteLinkAsBotFailureReason =
  | 'bot_not_found'
  | SupergroupBotAccessFailureReason
  /** The name is not well-formed Unicode, which Telegram rejects as not encoded in UTF-8. */
  | 'text_encoding_invalid'
  /** A link that creates join requests has no member limit, as TDLib refuses one. */
  | 'member_limit_with_join_request'
  /** The bot lacks the `can_invite_users` administrator right. */
  | 'not_enough_rights'
  /** The expiry date is not in the future, which Telegram refuses as `EXPIRE_DATE_INVALID`. */
  | 'expiry_date_invalid'
  /** The member limit exceeds 99999, which Telegram refuses as `USAGE_LIMIT_INVALID`. */
  | 'member_limit_invalid';

export type CreateInviteLinkAsBotResult =
  | { readonly created: true; readonly link: ChatInviteLink }
  | { readonly created: false; readonly reason: CreateInviteLinkAsBotFailureReason };

export interface JoinChatByInviteLinkInput {
  readonly accountId: number;
  /** The link as the account received it. */
  readonly inviteLinkUrl: string;
}

/** Why an account cannot join a chat by itself, whether by its username or an invite link. */
type SelfJoinFailureReason =
  | 'account_not_found'
  /** The account is a member already. */
  | 'already_a_member'
  /** The account is banned from the chat. */
  | 'banned';

export type JoinChatByInviteLinkResult =
  | {
    readonly used: true;
    readonly chatId: number;
    /** The account joined, or, through a link that creates join requests, sent a request. */
    readonly outcome: 'joined' | 'join_request_sent';
  }
  | {
    readonly used: false;
    readonly reason:
      | SelfJoinFailureReason
      /** No link of the session has this URL. */
      | 'invite_link_not_found'
      /** A test made the link's expiry date arrive. */
      | 'invite_link_expired'
      /** As many users as the link's member limit allows joined through it and are members. */
      | 'invite_link_member_limit_reached'
      /** The account's request to join the chat is pending already. */
      | 'join_request_pending';
  };

export interface JoinPublicSupergroupInput {
  readonly accountId: number;
  readonly chatId: number;
}

export type JoinPublicSupergroupResult =
  | { readonly joined: true }
  | {
    readonly joined: false;
    readonly reason:
      | SelfJoinFailureReason
      | 'chat_not_found'
      /** The supergroup has no username, so only an invite link or its owner lets users in. */
      | 'chat_not_public';
  };

/**
 * Why an account cannot inspect a supergroup's invite links or join requests, which only its owner
 * inspects among accounts.
 */
export type OwnerInspectionFailureReason =
  | 'account_not_found'
  | 'chat_not_found'
  | 'not_the_owner';

export interface GetInviteLinksForAccountInput {
  /** The account that inspects the links, which must own the supergroup. */
  readonly accountId: number;
  readonly chatId: number;
}

/** An invite link with how many current members of its chat joined through it. */
export interface ChatInviteLinkUsage {
  readonly link: ChatInviteLink;
  /** The members that joined through the link and still are, which its member limit counts. */
  readonly memberCount: number;
  /** The pending join requests sent through the link. */
  readonly pendingJoinRequestCount: number;
}

export type GetInviteLinksForAccountResult =
  | {
    readonly found: true;
    /** The chat's links in the order they were created. */
    readonly links: readonly ChatInviteLinkUsage[];
  }
  | {
    readonly found: false;
    readonly reason: OwnerInspectionFailureReason;
  };

export interface DecideJoinRequestAsBotInput {
  readonly deciderBotId: number;
  readonly chatId: number;
  /** The account whose request the bot approves or declines. */
  readonly userId: number;
}

/**
 * Why a bot cannot approve or decline a join request, in the order the official Bot API server,
 * TDLib's `process_dialog_join_request`, and then Telegram's servers check them.
 */
export type DecideJoinRequestAsBotFailureReason =
  | 'bot_not_found'
  | SupergroupBotAccessFailureReason
  /** The bot lacks the `can_invite_users` administrator right. */
  | 'not_enough_rights'
  /** The user is a member, which Telegram refuses as `USER_ALREADY_PARTICIPANT`. */
  | 'already_a_member'
  /** The user has no pending request, which Telegram refuses as `HIDE_REQUESTER_MISSING`. */
  | 'join_request_missing';

export type DecideJoinRequestAsBotResult =
  | { readonly decided: true }
  | { readonly decided: false; readonly reason: DecideJoinRequestAsBotFailureReason };

export interface GetJoinRequestsForAccountInput {
  /** The account that inspects the requests, which must own the supergroup. */
  readonly accountId: number;
  readonly chatId: number;
}

export type GetJoinRequestsForAccountResult =
  | {
    readonly found: true;
    /** The chat's pending join requests in the order they were sent. */
    readonly requests: readonly ChatJoinRequest[];
  }
  | {
    readonly found: false;
    readonly reason: OwnerInspectionFailureReason;
  };

export interface ExpireInviteLinkInput {
  readonly chatId: number;
  readonly inviteLinkUrl: string;
}

export type ExpireInviteLinkResult =
  | { readonly expired: true; readonly link: ChatInviteLinkUsage }
  | {
    readonly expired: false;
    readonly reason:
      | 'chat_not_found'
      | 'invite_link_not_found'
      /** The link has no expiry date, or its expiry date arrived before. */
      | 'invite_link_not_expirable';
  };

interface AccountLookup {
  getById(accountId: number): VirtualAccount | undefined;
}

interface BotLookup {
  getById(botId: number): VirtualBot | undefined;
}

interface ChatAdmissionStore extends SupergroupMembershipLookup {
  countMembersJoinedByInviteLink(chatId: number, inviteLinkUrl: string): number;
  addJoinRequest(request: ChatJoinRequest): void;
  getJoinRequest(chatId: number, userId: number): ChatJoinRequest | undefined;
  removeJoinRequest(chatId: number, userId: number): boolean;
  listJoinRequests(chatId: number): readonly ChatJoinRequest[];
  countJoinRequestsByInviteLink(chatId: number, inviteLinkUrl: string): number;
}

interface ChatDomainEventSink {
  publish(event: ChatDomainEvent): void;
}

interface ChatInviteLinkStore {
  createInviteLink(newLink: NewChatInviteLink): ChatInviteLink;
  findInviteLink(url: string): ChatInviteLink | undefined;
  listChatInviteLinks(chatId: number): readonly ChatInviteLink[];
  markInviteLinkExpired(url: string): ChatInviteLink;
}

interface AccountAdmission {
  admitAccount(
    input: {
      readonly accountId: number;
      readonly chatId: number;
      readonly inviteLink?: ChatInviteLink;
      readonly approverId?: number;
    },
  ): void;
}

interface ChatAdmissionServiceDependencies {
  readonly accounts: AccountLookup;
  readonly bots: BotLookup;
  readonly sharedChats: ChatAdmissionStore;
  readonly inviteLinks: ChatInviteLinkStore;
  /** Adds the accounts that may join, publishing and recording each join. */
  readonly memberships: AccountAdmission;
  /** Receives each join request an account sends. */
  readonly events: ChatDomainEventSink;
  /** The time links are created and requests sent at, which an expiry date must lie after. */
  readonly currentUnixTimeSeconds: () => number;
}

/**
 * Decides who may enter a supergroup without its owner adding them: administrator bots create
 * additional invite links, and accounts join through them, or by the username of a public
 * supergroup. A link keeps its creator, its expiry date, its member limit, and whether it creates
 * join requests, which keep the account outside until an administrator bot with
 * `can_invite_users` approves or declines them. Its expiry date arrives only when a test makes it
 * arrive, so tests decide when a link stops working.
 */
export class ChatAdmissionService {
  readonly #accounts: AccountLookup;
  readonly #bots: BotLookup;
  readonly #sharedChats: ChatAdmissionStore;
  readonly #inviteLinks: ChatInviteLinkStore;
  readonly #memberships: AccountAdmission;
  readonly #events: ChatDomainEventSink;
  readonly #currentUnixTimeSeconds: () => number;

  constructor(
    { accounts, bots, sharedChats, inviteLinks, memberships, events, currentUnixTimeSeconds }:
      ChatAdmissionServiceDependencies,
  ) {
    this.#accounts = accounts;
    this.#bots = bots;
    this.#sharedChats = sharedChats;
    this.#inviteLinks = inviteLinks;
    this.#memberships = memberships;
    this.#events = events;
    this.#currentUnixTimeSeconds = currentUnixTimeSeconds;
  }

  /**
   * Creates an additional invite link of a supergroup as an administrator bot, as TDLib's
   * `createChatInviteLink` does: its name is cleaned as `cleanName` cleans it, keeping at most 32
   * characters; a link that creates join requests has no member limit; and the bot needs the
   * `can_invite_users` administrator right, which TDLib's `can_manage_invite_links` requires to be
   * granted, so that default permissions never let a bot create links. Telegram's servers then
   * refuse an expiry date that is not in the future and a member limit above 99999.
   */
  createInviteLinkAsBot(input: CreateInviteLinkAsBotInput): CreateInviteLinkAsBotResult {
    if (this.#bots.getById(input.creatorBotId) === undefined) {
      return { created: false, reason: 'bot_not_found' };
    }
    const access = resolveSupergroupBotMembership(
      this.#sharedChats,
      input.creatorBotId,
      input.chatId,
    );
    if (!access.resolved) {
      return { created: false, reason: access.reason };
    }
    const cleanedName = cleanInputString(input.name);
    if (cleanedName === undefined) {
      return { created: false, reason: 'text_encoding_invalid' };
    }
    if (input.createsJoinRequest && input.memberLimit !== undefined) {
      return { created: false, reason: 'member_limit_with_join_request' };
    }
    if (!holdsSupergroupAdministratorRight(access.membership, 'can_invite_users')) {
      return { created: false, reason: 'not_enough_rights' };
    }
    const createdAtUnixSeconds = this.#currentUnixTimeSeconds();
    if (
      input.expiresAtUnixSeconds !== undefined &&
      input.expiresAtUnixSeconds <= createdAtUnixSeconds
    ) {
      return { created: false, reason: 'expiry_date_invalid' };
    }
    if (input.memberLimit !== undefined && input.memberLimit > MAX_INVITE_LINK_MEMBER_LIMIT) {
      return { created: false, reason: 'member_limit_invalid' };
    }

    const name = cleanName(cleanedName, MAX_INVITE_LINK_NAME_LENGTH);
    const link = this.#inviteLinks.createInviteLink({
      chatId: input.chatId,
      creatorId: input.creatorBotId,
      ...(name.length === 0 ? {} : { name }),
      createdAtUnixSeconds,
      ...(input.expiresAtUnixSeconds === undefined
        ? {}
        : { expiresAtUnixSeconds: input.expiresAtUnixSeconds }),
      ...(input.memberLimit === undefined ? {} : { memberLimit: input.memberLimit }),
      createsJoinRequest: input.createsJoinRequest,
    });
    return { created: true, link };
  }

  /**
   * Uses an invite link as an account, as TDLib's `joinChatByInviteLink` asks Telegram's servers
   * to: the link must be one of the session's, its expiry date must not have arrived, and its
   * member limit must leave a place, counting the members that joined through it and still are.
   * The account must be neither a member nor banned.
   *
   * A link that creates join requests stores the account's request and leaves it outside, as
   * Telegram answers `INVITE_REQUEST_SENT`; the chat's administrator bots with
   * `can_invite_users` receive it. An account has one pending request per chat, so using such a
   * link again while its request is pending changes nothing. Any other link lets the account
   * join, a restricted user with its restriction, and the membership remembers the link, which
   * the chat's administrator bots see in the `chat_member` update.
   */
  joinChatByInviteLink(
    { accountId, inviteLinkUrl }: JoinChatByInviteLinkInput,
  ): JoinChatByInviteLinkResult {
    if (this.#accounts.getById(accountId) === undefined) {
      return { used: false, reason: 'account_not_found' };
    }
    const link = this.#inviteLinks.findInviteLink(inviteLinkUrl);
    if (link === undefined) {
      return { used: false, reason: 'invite_link_not_found' };
    }
    if (link.hasExpired) {
      return { used: false, reason: 'invite_link_expired' };
    }
    if (
      link.memberLimit !== undefined &&
      this.#sharedChats.countMembersJoinedByInviteLink(link.chatId, link.url) >= link.memberLimit
    ) {
      return { used: false, reason: 'invite_link_member_limit_reached' };
    }
    const standingFailure = this.#findSelfJoinStandingFailure(link.chatId, accountId);
    if (standingFailure !== undefined) {
      return { used: false, reason: standingFailure };
    }
    if (link.createsJoinRequest) {
      return this.#sendJoinRequest(accountId, link);
    }

    this.#memberships.admitAccount({ accountId, chatId: link.chatId, inviteLink: link });
    return { used: true, chatId: link.chatId, outcome: 'joined' };
  }

  /**
   * Lets an account join a public supergroup by itself, as TDLib's `join_channel` does for a
   * supergroup it finds by its username. The account must be neither a member nor banned; a
   * member is told so whether the supergroup is public or not.
   */
  joinPublicSupergroup(
    { accountId, chatId }: JoinPublicSupergroupInput,
  ): JoinPublicSupergroupResult {
    if (this.#accounts.getById(accountId) === undefined) {
      return { joined: false, reason: 'account_not_found' };
    }
    const supergroup = this.#sharedChats.getSharedChat(chatId);
    if (supergroup?.kind !== 'supergroup') {
      return { joined: false, reason: 'chat_not_found' };
    }
    const standingFailure = this.#findSelfJoinStandingFailure(chatId, accountId);
    if (standingFailure !== undefined) {
      return { joined: false, reason: standingFailure };
    }
    if (supergroup.username === undefined) {
      return { joined: false, reason: 'chat_not_public' };
    }

    this.#memberships.admitAccount({ accountId, chatId });
    return { joined: true };
  }

  /**
   * Returns the invite links of a supergroup to its owner, with how many members joined through
   * each. As TDLib's `getChatInviteLinks` requires the owner for links that other administrators
   * created, and only bots create links here, only the owner sees them.
   */
  getInviteLinksForAccount(
    { accountId, chatId }: GetInviteLinksForAccountInput,
  ): GetInviteLinksForAccountResult {
    const inspectionFailure = this.#authorizeOwnerInspection(accountId, chatId);
    if (inspectionFailure !== undefined) {
      return { found: false, reason: inspectionFailure };
    }
    return {
      found: true,
      links: this.#inviteLinks.listChatInviteLinks(chatId).map((link) => this.#describeUsage(link)),
    };
  }

  /**
   * Approves an account's pending request to join a supergroup as an administrator bot: the
   * account joins, restricted if it was, through the link it sent the request through, and the
   * request ends. The join is the account's own service message, and administrator bots receive
   * it from the approving bot with the link. Checks are as `#resolveJoinRequestDecision` makes them.
   */
  approveJoinRequestAsBot(input: DecideJoinRequestAsBotInput): DecideJoinRequestAsBotResult {
    const decision = this.#resolveJoinRequestDecision(input);
    if (!decision.resolved) {
      return { decided: false, reason: decision.reason };
    }
    const { request } = decision;
    const inviteLink = this.#inviteLinks.findInviteLink(request.inviteLinkUrl);
    if (inviteLink === undefined) {
      throw new Error(
        `Join request of user ${request.userId} names unknown link ${request.inviteLinkUrl}`,
      );
    }
    this.#memberships.admitAccount({
      accountId: request.userId,
      chatId: request.chatId,
      inviteLink,
      approverId: input.deciderBotId,
    });
    return { decided: true };
  }

  /**
   * Declines an account's pending request to join a supergroup as an administrator bot: the
   * request ends and the account stays outside, which no update reports. Checks are as
   * `#resolveJoinRequestDecision` makes them.
   */
  declineJoinRequestAsBot(input: DecideJoinRequestAsBotInput): DecideJoinRequestAsBotResult {
    const decision = this.#resolveJoinRequestDecision(input);
    if (!decision.resolved) {
      return { decided: false, reason: decision.reason };
    }
    if (!this.#sharedChats.removeJoinRequest(input.chatId, input.userId)) {
      throw new Error(`Join request of user ${input.userId} to chat ${input.chatId} vanished`);
    }
    return { decided: true };
  }

  /**
   * Returns the pending join requests of a supergroup to its owner, in the order they were sent.
   * Requests reach administrator bots with `can_invite_users`; among accounts, only the owner
   * inspects them, as for the invite links they were sent through.
   */
  getJoinRequestsForAccount(
    { accountId, chatId }: GetJoinRequestsForAccountInput,
  ): GetJoinRequestsForAccountResult {
    const inspectionFailure = this.#authorizeOwnerInspection(accountId, chatId);
    if (inspectionFailure !== undefined) {
      return { found: false, reason: inspectionFailure };
    }
    return { found: true, requests: this.#sharedChats.listJoinRequests(chatId) };
  }

  /**
   * Makes an invite link's expiry date arrive, which the emulator never does as time passes: the
   * link stops working for good, and the members that joined through it stay.
   */
  expireInviteLink({ chatId, inviteLinkUrl }: ExpireInviteLinkInput): ExpireInviteLinkResult {
    if (this.#sharedChats.getSharedChat(chatId)?.kind !== 'supergroup') {
      return { expired: false, reason: 'chat_not_found' };
    }
    const link = this.#inviteLinks.findInviteLink(inviteLinkUrl);
    if (link?.chatId !== chatId) {
      return { expired: false, reason: 'invite_link_not_found' };
    }
    if (link.expiresAtUnixSeconds === undefined || link.hasExpired) {
      return { expired: false, reason: 'invite_link_not_expirable' };
    }
    return {
      expired: true,
      link: this.#describeUsage(this.#inviteLinks.markInviteLinkExpired(link.url)),
    };
  }

  /**
   * Returns why an account may not inspect a supergroup's invite links and join requests, or
   * `undefined` when it owns the supergroup and may.
   */
  #authorizeOwnerInspection(
    accountId: number,
    chatId: number,
  ): OwnerInspectionFailureReason | undefined {
    if (this.#accounts.getById(accountId) === undefined) {
      return 'account_not_found';
    }
    if (this.#sharedChats.getSharedChat(chatId)?.kind !== 'supergroup') {
      return 'chat_not_found';
    }
    if (this.#sharedChats.getChatMembership(chatId, accountId)?.status !== 'owner') {
      return 'not_the_owner';
    }
    return undefined;
  }

  /**
   * Finds the pending request a bot decides on, as TDLib's `process_dialog_join_request` and then
   * Telegram's servers check it: the bot must be able to write to the supergroup and, as TDLib's
   * `can_manage_dialog_join_requests` requires, hold the `can_invite_users` administrator right,
   * whoever created the link the request was sent through. A member has no request to decide,
   * and neither has a user whose request was decided before.
   */
  #resolveJoinRequestDecision(
    { deciderBotId, chatId, userId }: DecideJoinRequestAsBotInput,
  ):
    | { readonly resolved: true; readonly request: ChatJoinRequest }
    | { readonly resolved: false; readonly reason: DecideJoinRequestAsBotFailureReason } {
    if (this.#bots.getById(deciderBotId) === undefined) {
      return { resolved: false, reason: 'bot_not_found' };
    }
    const access = resolveSupergroupBotMembership(this.#sharedChats, deciderBotId, chatId);
    if (!access.resolved) {
      return { resolved: false, reason: access.reason };
    }
    if (!holdsSupergroupAdministratorRight(access.membership, 'can_invite_users')) {
      return { resolved: false, reason: 'not_enough_rights' };
    }
    if (this.#sharedChats.getChatMembership(chatId, userId) !== undefined) {
      return { resolved: false, reason: 'already_a_member' };
    }
    const request = this.#sharedChats.getJoinRequest(chatId, userId);
    return request === undefined
      ? { resolved: false, reason: 'join_request_missing' }
      : { resolved: true, request };
  }

  /**
   * Stores an account's request to join the chat a link leads to, and publishes it, unless its
   * request is pending already.
   */
  #sendJoinRequest(accountId: number, link: ChatInviteLink): JoinChatByInviteLinkResult {
    if (this.#sharedChats.getJoinRequest(link.chatId, accountId) !== undefined) {
      return { used: false, reason: 'join_request_pending' };
    }
    const chat = this.#sharedChats.getSharedChat(link.chatId);
    if (chat?.kind !== 'supergroup') {
      throw new Error(
        `Invite link ${link.url} leads to chat ${link.chatId}, which is no supergroup`,
      );
    }
    const request: ChatJoinRequest = {
      chatId: link.chatId,
      userId: accountId,
      inviteLinkUrl: link.url,
      requestedAtUnixSeconds: this.#currentUnixTimeSeconds(),
    };
    this.#sharedChats.addJoinRequest(request);
    this.#events.publish({ type: 'chat_join_requested', chat, request, inviteLink: link });
    return { used: true, chatId: link.chatId, outcome: 'join_request_sent' };
  }

  /**
   * Finds why a user's standing keeps it from joining a chat by itself: it is a member already, or
   * banned. A restricted user that is not a member may join.
   */
  #findSelfJoinStandingFailure(
    chatId: number,
    userId: number,
  ): 'already_a_member' | 'banned' | undefined {
    if (this.#sharedChats.getChatMembership(chatId, userId) !== undefined) {
      return 'already_a_member';
    }
    return this.#sharedChats.getFormerMemberStatus(chatId, userId)?.status === 'kicked'
      ? 'banned'
      : undefined;
  }

  #describeUsage(link: ChatInviteLink): ChatInviteLinkUsage {
    return {
      link,
      memberCount: this.#sharedChats.countMembersJoinedByInviteLink(link.chatId, link.url),
      pendingJoinRequestCount: this.#sharedChats.countJoinRequestsByInviteLink(
        link.chatId,
        link.url,
      ),
    };
  }
}
