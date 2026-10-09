import type { NewChatInviteLink } from '../repositories/chat_invite_link.ts';
import { cleanInputString, cleanName } from '../text_entities/input_string.ts';
import {
  type ChatInviteLink,
  type ChatInviteLinkSettings,
  MAX_INVITE_LINK_MEMBER_LIMIT,
  MAX_INVITE_LINK_NAME_LENGTH,
} from '../types/chat_invite_link.ts';
import {
  type ChatMembership,
  holdsSupergroupAdministratorRight,
  resolveSupergroupBotMembership,
  type SupergroupBotAccessFailureReason,
  type SupergroupMembershipLookup,
} from '../types/chat_membership.ts';
import type { ChatDomainEvent } from '../types/chat_domain_event.ts';
import type { ChatJoinRequest, JoinRequesterContact } from '../types/chat_join_request.ts';
import type { VirtualAccount } from '../types/virtual_account.ts';
import type { VirtualBot } from '../types/virtual_bot.ts';

/**
 * The settings a bot requests for an invite link it creates or edits, before Telegram cleans and
 * checks them. An edit replaces every setting, so an omitted one is none.
 */
export interface RequestedInviteLinkSettings {
  /** The link's name as the bot specified it, before Telegram cleans it; empty for none. */
  readonly name: string;
  /** When the link stops working, which must be in the future; omitted for never. */
  readonly expiresAtUnixSeconds?: number;
  /** How many users that joined through the link may be members at once; omitted for no limit. */
  readonly memberLimit?: number;
  readonly createsJoinRequest: boolean;
}

export interface CreateInviteLinkAsBotInput extends RequestedInviteLinkSettings {
  readonly creatorBotId: number;
  readonly chatId: number;
}

/** Why a bot cannot manage a supergroup's invite links at all. */
type InviteLinkManagerFailureReason =
  | 'bot_not_found'
  | SupergroupBotAccessFailureReason
  /** A name or link is not well-formed Unicode, which Telegram rejects as not encoded in UTF-8. */
  | 'text_encoding_invalid'
  /** The bot lacks the `can_invite_users` administrator right. */
  | 'not_enough_rights';

/** Why Telegram's servers refuse the settings a bot requested for a link. */
type InviteLinkSettingsFailureReason =
  /** The expiry date is not in the future, which Telegram refuses as `EXPIRE_DATE_INVALID`. */
  | 'expiry_date_invalid'
  /** The member limit exceeds 99999, which Telegram refuses as `USAGE_LIMIT_INVALID`. */
  | 'member_limit_invalid';

/**
 * Why a bot cannot create an invite link, in the order the official Bot API server, TDLib's
 * `export_dialog_invite_link`, and then Telegram's servers check them: the bot and the chat, the
 * name's encoding, the member limit of a link that creates join requests, the bot's right, and
 * the settings.
 */
export type CreateInviteLinkAsBotFailureReason =
  | InviteLinkManagerFailureReason
  /** A link that creates join requests has no member limit, as TDLib refuses one. */
  | 'member_limit_with_join_request'
  | InviteLinkSettingsFailureReason;

export type CreateInviteLinkAsBotResult =
  | { readonly created: true; readonly link: ChatInviteLink }
  | { readonly created: false; readonly reason: CreateInviteLinkAsBotFailureReason };

export interface EditInviteLinkAsBotInput extends RequestedInviteLinkSettings {
  readonly editorBotId: number;
  readonly chatId: number;
  /** The whole link, as its creator received it. */
  readonly inviteLinkUrl: string;
}

/** Why a bot cannot edit or revoke the invite link it names, once it may manage links. */
type ManagedInviteLinkFailureReason =
  /** The bot named no link, which TDLib refuses before asking Telegram's servers. */
  | 'invite_link_empty'
  /** No link of the chat has this URL, including a link of another chat or session. */
  | 'invite_link_not_found'
  /** Another administrator created the link, which only the chat's owner could manage. */
  | 'not_the_link_creator'
  /** The link was revoked, after which it can be neither edited nor revoked again. */
  | 'invite_link_revoked';

/**
 * Why a bot cannot edit an invite link, in the order the official Bot API server, TDLib's
 * `edit_dialog_invite_link`, and then Telegram's servers check them: the bot and the chat, the
 * encoding of the name and link, the bot's right, the member limit of a link that creates join
 * requests, the link, and the settings.
 */
export type EditInviteLinkAsBotFailureReason =
  | InviteLinkManagerFailureReason
  | 'member_limit_with_join_request'
  | ManagedInviteLinkFailureReason
  | InviteLinkSettingsFailureReason;

export type EditInviteLinkAsBotResult =
  | { readonly edited: true; readonly link: ChatInviteLink }
  | { readonly edited: false; readonly reason: EditInviteLinkAsBotFailureReason };

export interface RevokeInviteLinkAsBotInput {
  readonly revokerBotId: number;
  readonly chatId: number;
  /** The whole link, as its creator received it. */
  readonly inviteLinkUrl: string;
}

/**
 * Why a bot cannot revoke an invite link, in the order the official Bot API server, TDLib's
 * `revoke_dialog_invite_link`, and then Telegram's servers check them.
 */
export type RevokeInviteLinkAsBotFailureReason =
  | InviteLinkManagerFailureReason
  | ManagedInviteLinkFailureReason;

export type RevokeInviteLinkAsBotResult =
  | { readonly revoked: true; readonly link: ChatInviteLink }
  | { readonly revoked: false; readonly reason: RevokeInviteLinkAsBotFailureReason };

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
      /** The link's creator revoked it. */
      | 'invite_link_revoked'
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
 * Why the request an authorized administrator names cannot be decided, as Telegram's servers
 * refuse it after TDLib checked the administrator.
 */
type JoinRequestTargetFailureReason =
  /** The user is a member, which Telegram refuses as `USER_ALREADY_PARTICIPANT`. */
  | 'already_a_member'
  /** The user has no pending request, which Telegram refuses as `HIDE_REQUESTER_MISSING`. */
  | 'join_request_missing';

/**
 * Why a bot cannot approve or decline a join request, in the order the official Bot API server,
 * TDLib's `process_dialog_join_request`, and then Telegram's servers check them.
 */
export type DecideJoinRequestAsBotFailureReason =
  | 'bot_not_found'
  | SupergroupBotAccessFailureReason
  /** The bot lacks the `can_invite_users` administrator right. */
  | 'not_enough_rights'
  | JoinRequestTargetFailureReason;

export type DecideJoinRequestAsBotResult =
  | { readonly decided: true }
  | { readonly decided: false; readonly reason: DecideJoinRequestAsBotFailureReason };

/** Whether an administrator lets the requester in or leaves it outside. */
export type JoinRequestDecision = 'approve' | 'decline';

export interface DecideJoinRequestAsAccountInput {
  /** The owner, or an administrator account holding `can_invite_users`. */
  readonly deciderAccountId: number;
  readonly chatId: number;
  /** The account whose request the decider approves or declines. */
  readonly userId: number;
  readonly decision: JoinRequestDecision;
}

/**
 * Why an account cannot approve or decline a join request, in the order TDLib's
 * `process_dialog_join_request` and then Telegram's servers check them.
 */
export type DecideJoinRequestAsAccountFailureReason =
  | 'account_not_found'
  /** No supergroup of the session has the chat ID. */
  | 'chat_not_found'
  /**
   * The account is neither the owner nor an administrator holding `can_invite_users`, including
   * when it is not a member, as TDLib's `can_manage_dialog_join_requests` refuses it.
   */
  | 'not_enough_rights'
  | JoinRequestTargetFailureReason;

export type DecideJoinRequestAsAccountResult =
  | { readonly decided: true }
  | { readonly decided: false; readonly reason: DecideJoinRequestAsAccountFailureReason };

export interface GetJoinRequestsForAccountInput {
  /** The account that inspects the requests, which must own the supergroup. */
  readonly accountId: number;
  readonly chatId: number;
}

/** A pending join request with the bots that may write to its user under its contact grant. */
export interface PendingChatJoinRequest {
  readonly request: ChatJoinRequest;
  /**
   * The bots that may write to the user before it starts a private chat with them, as
   * `ChatAdmissionService.mayContactJoinRequester` decides it; empty for none.
   */
  readonly contactBotIds: readonly number[];
}

export type GetJoinRequestsForAccountResult =
  | {
    readonly found: true;
    /** The chat's pending join requests in the order they were sent. */
    readonly requests: readonly PendingChatJoinRequest[];
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

export interface ExpireJoinRequesterContactInput {
  readonly chatId: number;
  /** The account whose pending request's contact window ends. */
  readonly userId: number;
}

export type ExpireJoinRequesterContactResult =
  | { readonly expired: true; readonly request: PendingChatJoinRequest }
  | {
    readonly expired: false;
    readonly reason:
      | 'chat_not_found'
      /** The user has no pending request to join the chat. */
      | 'join_request_not_found'
      /** A test ended the request's contact window before. */
      | 'requester_contact_already_expired';
  };

interface AccountLookup {
  getById(accountId: number): VirtualAccount | undefined;
}

interface BotLookup {
  getById(botId: number): VirtualBot | undefined;
}

interface ChatAdmissionStore extends SupergroupMembershipLookup {
  getChatMemberIds(chatId: number): readonly number[];
  countMembersJoinedByInviteLink(chatId: number, inviteLinkUrl: string): number;
  addJoinRequest(request: ChatJoinRequest): void;
  getJoinRequest(chatId: number, userId: number): ChatJoinRequest | undefined;
  removeJoinRequest(chatId: number, userId: number): boolean;
  listJoinRequests(chatId: number): readonly ChatJoinRequest[];
  listJoinRequestsOfUser(userId: number): readonly ChatJoinRequest[];
  setJoinRequesterContact(
    chatId: number,
    userId: number,
    requesterContact: JoinRequesterContact,
  ): ChatJoinRequest;
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
  replaceInviteLinkSettings(url: string, settings: ChatInviteLinkSettings): ChatInviteLink;
  markInviteLinkRevoked(url: string): ChatInviteLink;
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
 * Decides who may enter a supergroup without its owner adding them: administrator bots create,
 * edit and revoke additional invite links, and accounts join through them, or by the username of
 * a public supergroup. A link keeps its creator, its expiry date, its member limit, and whether it
 * creates join requests, which keep the account outside until the owner, or an administrator bot
 * or account with `can_invite_users`, approves or declines them. Until then, the bots that
 * received a request may contact its user, as `mayContactJoinRequester` decides. A link's edits,
 * revocation and expiry affect only its later uses, never the requests already sent through it.
 * A link's expiry date, like the end of a request's contact window, arrives only when a test makes
 * it arrive, so tests decide when a link stops working.
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
    const manager = this.#resolveInviteLinkManager(input.creatorBotId, input.chatId);
    if (!manager.resolved) {
      return { created: false, reason: manager.reason };
    }
    const cleanedName = cleanInputString(input.name);
    if (cleanedName === undefined) {
      return { created: false, reason: 'text_encoding_invalid' };
    }
    if (input.createsJoinRequest && input.memberLimit !== undefined) {
      return { created: false, reason: 'member_limit_with_join_request' };
    }
    if (!holdsSupergroupAdministratorRight(manager.membership, 'can_invite_users')) {
      return { created: false, reason: 'not_enough_rights' };
    }
    const createdAtUnixSeconds = this.#currentUnixTimeSeconds();
    const settings = this.#resolveInviteLinkSettings(input, cleanedName, createdAtUnixSeconds);
    if (!settings.resolved) {
      return { created: false, reason: settings.reason };
    }

    const link = this.#inviteLinks.createInviteLink({
      chatId: input.chatId,
      creatorId: input.creatorBotId,
      createdAtUnixSeconds,
      ...settings.settings,
    });
    return { created: true, link };
  }

  /**
   * Edits an invite link as the administrator bot that created it, as TDLib's
   * `editChatInviteLink` does: the edit replaces every setting, so an omitted name, expiry date or
   * member limit becomes none, and the settings are cleaned and checked as for a new link. As
   * TDLib's `edit_dialog_invite_link` checks them, the bot needs `can_invite_users` before a
   * link that creates join requests is refused a member limit, and the link must be named. Telegram's
   * servers then find the link among the chat's, let only its creator edit it, and refuse a
   * revoked link.
   *
   * The edited link applies to later uses only: members that joined through it stay, and pending
   * join requests sent through it stay pending with their requester contact, however the edit
   * changed whether the link creates join requests. An edit gives the link a new expiry date that
   * has not arrived, or none, so a link whose expiry date a test made arrive works again.
   */
  editInviteLinkAsBot(input: EditInviteLinkAsBotInput): EditInviteLinkAsBotResult {
    const manager = this.#resolveInviteLinkManager(input.editorBotId, input.chatId);
    if (!manager.resolved) {
      return { edited: false, reason: manager.reason };
    }
    const cleanedName = cleanInputString(input.name);
    const cleanedInviteLinkUrl = cleanInputString(input.inviteLinkUrl);
    if (cleanedName === undefined || cleanedInviteLinkUrl === undefined) {
      return { edited: false, reason: 'text_encoding_invalid' };
    }
    if (!holdsSupergroupAdministratorRight(manager.membership, 'can_invite_users')) {
      return { edited: false, reason: 'not_enough_rights' };
    }
    if (input.createsJoinRequest && input.memberLimit !== undefined) {
      return { edited: false, reason: 'member_limit_with_join_request' };
    }
    const managedLink = this.#findManagedInviteLink(
      input.editorBotId,
      input.chatId,
      cleanedInviteLinkUrl,
    );
    if (!managedLink.found) {
      return { edited: false, reason: managedLink.reason };
    }
    const settings = this.#resolveInviteLinkSettings(
      input,
      cleanedName,
      this.#currentUnixTimeSeconds(),
    );
    if (!settings.resolved) {
      return { edited: false, reason: settings.reason };
    }

    return {
      edited: true,
      link: this.#inviteLinks.replaceInviteLinkSettings(managedLink.link.url, settings.settings),
    };
  }

  /**
   * Revokes an invite link as the administrator bot that created it, as TDLib's
   * `revokeChatInviteLink` does, with the checks of `editInviteLinkAsBot` that apply to it: the
   * link admits nobody from then on, and can be neither edited nor revoked again. Members that
   * joined through it stay, and pending join requests sent through it stay pending with their
   * requester contact, for an administrator to decide.
   */
  revokeInviteLinkAsBot(
    { revokerBotId, chatId, inviteLinkUrl }: RevokeInviteLinkAsBotInput,
  ): RevokeInviteLinkAsBotResult {
    const manager = this.#resolveInviteLinkManager(revokerBotId, chatId);
    if (!manager.resolved) {
      return { revoked: false, reason: manager.reason };
    }
    const cleanedInviteLinkUrl = cleanInputString(inviteLinkUrl);
    if (cleanedInviteLinkUrl === undefined) {
      return { revoked: false, reason: 'text_encoding_invalid' };
    }
    if (!holdsSupergroupAdministratorRight(manager.membership, 'can_invite_users')) {
      return { revoked: false, reason: 'not_enough_rights' };
    }
    const managedLink = this.#findManagedInviteLink(revokerBotId, chatId, cleanedInviteLinkUrl);
    if (!managedLink.found) {
      return { revoked: false, reason: managedLink.reason };
    }

    return { revoked: true, link: this.#inviteLinks.markInviteLinkRevoked(managedLink.link.url) };
  }

  /**
   * Uses an invite link as an account, as TDLib's `joinChatByInviteLink` asks Telegram's servers
   * to: the link must be one of the session's, not revoked, its expiry date must not have arrived,
   * and its member limit must leave a place, counting the members that joined through it and still
   * are. The account must be neither a member nor banned.
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
    if (link.isRevoked) {
      return { used: false, reason: 'invite_link_revoked' };
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
   * Approves an account's pending request to join a supergroup as an administrator bot, as
   * `#decideJoinRequest` does once `#authorizeBotJoinRequestDecider` lets the bot decide.
   */
  approveJoinRequestAsBot(
    { deciderBotId, chatId, userId }: DecideJoinRequestAsBotInput,
  ): DecideJoinRequestAsBotResult {
    return this.#decideJoinRequest(
      this.#authorizeBotJoinRequestDecider(deciderBotId, chatId),
      { deciderId: deciderBotId, chatId, userId, decision: 'approve' },
    );
  }

  /**
   * Declines an account's pending request to join a supergroup as an administrator bot, as
   * `#decideJoinRequest` does once `#authorizeBotJoinRequestDecider` lets the bot decide.
   */
  declineJoinRequestAsBot(
    { deciderBotId, chatId, userId }: DecideJoinRequestAsBotInput,
  ): DecideJoinRequestAsBotResult {
    return this.#decideJoinRequest(
      this.#authorizeBotJoinRequestDecider(deciderBotId, chatId),
      { deciderId: deciderBotId, chatId, userId, decision: 'decline' },
    );
  }

  /**
   * Approves or declines an account's pending request to join a supergroup as the owner or an
   * administrator account, as `#decideJoinRequest` does once `#authorizeAccountJoinRequestDecider`
   * lets the account decide. The account decides any request, whichever bot created the link it
   * was sent through, and an approval's `chat_member` update comes from it.
   */
  decideJoinRequestAsAccount(
    { deciderAccountId, chatId, userId, decision }: DecideJoinRequestAsAccountInput,
  ): DecideJoinRequestAsAccountResult {
    return this.#decideJoinRequest(
      this.#authorizeAccountJoinRequestDecider(deciderAccountId, chatId),
      { deciderId: deciderAccountId, chatId, userId, decision },
    );
  }

  /**
   * Returns the pending join requests of a supergroup to its owner, in the order they were sent.
   * Requests reach administrator bots with `can_invite_users`; among accounts, only the owner
   * inspects them, as for the invite links they were sent through, although administrator accounts
   * with the right decide them.
   */
  getJoinRequestsForAccount(
    { accountId, chatId }: GetJoinRequestsForAccountInput,
  ): GetJoinRequestsForAccountResult {
    const inspectionFailure = this.#authorizeOwnerInspection(accountId, chatId);
    if (inspectionFailure !== undefined) {
      return { found: false, reason: inspectionFailure };
    }
    return {
      found: true,
      requests: this.#sharedChats.listJoinRequests(chatId).map((request) =>
        this.#describePendingRequest(request)
      ),
    };
  }

  /**
   * Whether a pending join request lets a bot write to its user, which the user has not let it do
   * by starting a private chat with it. As the Bot API documents for `user_chat_id`, a bot that
   * received the request may send the user messages until the request is processed, assuming no
   * other administrator contacted the user: the first recipient bot to write claims the contact,
   * which ends the others' permission under that request. The bot must also still hold
   * `can_invite_users`, which deciding the request takes. The permission ends with the request,
   * whether approved, declined, or ended by the user's joining or ban, and when a test ends its
   * contact window.
   */
  mayContactJoinRequester(botId: number, userId: number): boolean {
    return this.#sharedChats.listJoinRequestsOfUser(userId)
      .some((request) => this.#listContactBotIds(request).includes(botId));
  }

  /**
   * Records that a bot wrote to a join request's user under the permission that
   * `mayContactJoinRequester` grants it: each of the user's pending requests whose contact the bot
   * may claim becomes the bot's alone. Call it only once the bot's message passed its checks.
   */
  claimJoinRequesterContact(botId: number, userId: number): void {
    const claimableRequests = this.#sharedChats.listJoinRequestsOfUser(userId).filter((request) =>
      this.#listContactBotIds(request).includes(botId)
    );
    if (claimableRequests.length === 0) {
      throw new Error(`Bot ${botId} may not contact join requester ${userId}`);
    }
    for (const request of claimableRequests) {
      if (request.requesterContact.status === 'open') {
        this.#sharedChats.setJoinRequesterContact(request.chatId, userId, {
          status: 'claimed',
          claimantBotId: botId,
        });
      }
    }
  }

  /**
   * Ends a pending join request's contact window, as its five minutes passing does, which the
   * emulator never lets happen by itself: no bot may write to the user under the request any more,
   * while bots the user started a private chat with keep writing to it. The request stays pending.
   */
  expireJoinRequesterContact(
    { chatId, userId }: ExpireJoinRequesterContactInput,
  ): ExpireJoinRequesterContactResult {
    if (this.#sharedChats.getSharedChat(chatId)?.kind !== 'supergroup') {
      return { expired: false, reason: 'chat_not_found' };
    }
    const request = this.#sharedChats.getJoinRequest(chatId, userId);
    if (request === undefined) {
      return { expired: false, reason: 'join_request_not_found' };
    }
    if (request.requesterContact.status === 'expired') {
      return { expired: false, reason: 'requester_contact_already_expired' };
    }
    return {
      expired: true,
      request: this.#describePendingRequest(
        this.#sharedChats.setJoinRequesterContact(chatId, userId, { status: 'expired' }),
      ),
    };
  }

  /**
   * Makes an invite link's expiry date arrive, which the emulator never does as time passes: the
   * link stops working until its creator edits it, and the members that joined through it stay,
   * as do the pending join requests sent through it. A revoked link's expiry date still arrives,
   * as time passes for it too.
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
   * Finds the membership of a bot that would manage a supergroup's invite links, which must be
   * able to write to the supergroup, as the official server's `check_chat` and TDLib's
   * `can_manage_dialog_invite_links` require before anything else.
   */
  #resolveInviteLinkManager(
    botId: number,
    chatId: number,
  ):
    | { readonly resolved: true; readonly membership: ChatMembership }
    | {
      readonly resolved: false;
      readonly reason: 'bot_not_found' | SupergroupBotAccessFailureReason;
    } {
    if (this.#bots.getById(botId) === undefined) {
      return { resolved: false, reason: 'bot_not_found' };
    }
    const access = resolveSupergroupBotMembership(this.#sharedChats, botId, chatId);
    return access.resolved
      ? { resolved: true, membership: access.membership }
      : { resolved: false, reason: access.reason };
  }

  /**
   * Finds the link a bot edits or revokes: a link of the chat that the bot created and did not
   * revoke. A link of another chat is unknown to the chat, as Telegram's servers look links up by
   * the chat the bot names.
   */
  #findManagedInviteLink(
    botId: number,
    chatId: number,
    inviteLinkUrl: string,
  ):
    | { readonly found: true; readonly link: ChatInviteLink }
    | { readonly found: false; readonly reason: ManagedInviteLinkFailureReason } {
    if (inviteLinkUrl.length === 0) {
      return { found: false, reason: 'invite_link_empty' };
    }
    const link = this.#inviteLinks.findInviteLink(inviteLinkUrl);
    if (link?.chatId !== chatId) {
      return { found: false, reason: 'invite_link_not_found' };
    }
    if (link.creatorId !== botId) {
      return { found: false, reason: 'not_the_link_creator' };
    }
    return link.isRevoked ? { found: false, reason: 'invite_link_revoked' } : { found: true, link };
  }

  /**
   * Turns the settings a bot requested for a link into the link's settings, as Telegram's servers
   * accept them: the expiry date must lie after the current time and the member limit must not
   * exceed 99999, and the name, already cleaned of what Telegram removes from input, is cleaned as
   * a chat title, keeping at most 32 characters.
   */
  #resolveInviteLinkSettings(
    requested: RequestedInviteLinkSettings,
    cleanedName: string,
    currentUnixTimeSeconds: number,
  ):
    | { readonly resolved: true; readonly settings: ChatInviteLinkSettings }
    | { readonly resolved: false; readonly reason: InviteLinkSettingsFailureReason } {
    const { expiresAtUnixSeconds, memberLimit, createsJoinRequest } = requested;
    if (expiresAtUnixSeconds !== undefined && expiresAtUnixSeconds <= currentUnixTimeSeconds) {
      return { resolved: false, reason: 'expiry_date_invalid' };
    }
    if (memberLimit !== undefined && memberLimit > MAX_INVITE_LINK_MEMBER_LIMIT) {
      return { resolved: false, reason: 'member_limit_invalid' };
    }
    const name = cleanName(cleanedName, MAX_INVITE_LINK_NAME_LENGTH);
    return {
      resolved: true,
      settings: {
        ...(name.length === 0 ? {} : { name }),
        ...(expiresAtUnixSeconds === undefined ? {} : { expiresAtUnixSeconds }),
        ...(memberLimit === undefined ? {} : { memberLimit }),
        createsJoinRequest,
      },
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
   * Returns why a bot may not decide a supergroup's join requests, or `undefined` when it may: as
   * TDLib's `process_dialog_join_request` checks it, the bot must be able to write to the
   * supergroup and, as `can_manage_dialog_join_requests` requires, hold the `can_invite_users`
   * administrator right.
   */
  #authorizeBotJoinRequestDecider(
    botId: number,
    chatId: number,
  ): Exclude<DecideJoinRequestAsBotFailureReason, JoinRequestTargetFailureReason> | undefined {
    if (this.#bots.getById(botId) === undefined) {
      return 'bot_not_found';
    }
    const access = resolveSupergroupBotMembership(this.#sharedChats, botId, chatId);
    if (!access.resolved) {
      return access.reason;
    }
    return holdsSupergroupAdministratorRight(access.membership, 'can_invite_users')
      ? undefined
      : 'not_enough_rights';
  }

  /**
   * Returns why an account may not decide a supergroup's join requests, or `undefined` when it
   * may: as TDLib's `can_manage_dialog_join_requests` checks the account's own standing, it must
   * own the supergroup or be an administrator explicitly granted `can_invite_users`. A member
   * without the right, a restricted user and a non-member may not.
   */
  #authorizeAccountJoinRequestDecider(
    accountId: number,
    chatId: number,
  ): Exclude<DecideJoinRequestAsAccountFailureReason, JoinRequestTargetFailureReason> | undefined {
    if (this.#accounts.getById(accountId) === undefined) {
      return 'account_not_found';
    }
    if (this.#sharedChats.getSharedChat(chatId)?.kind !== 'supergroup') {
      return 'chat_not_found';
    }
    return holdsSupergroupAdministratorRight(
        this.#sharedChats.getChatMembership(chatId, accountId),
        'can_invite_users',
      )
      ? undefined
      : 'not_enough_rights';
  }

  /**
   * Decides an account's pending request to join a supergroup for an administrator whose
   * authorization was just checked, which happens at decision time, so a lost right refuses it.
   * The request must still be pending, as Telegram's servers check it: a member has no request to
   * decide, and neither has a user whose request was decided before, by any administrator.
   *
   * Approval lets the account in, restricted if it was, through the link it sent the request
   * through, which ends the request; the join is the account's own service message, and
   * administrator bots receive it from the approver with the link. Declining ends the request and
   * leaves the account outside, which no update reports. Either way the request's requester
   * contact ends with it.
   */
  #decideJoinRequest<AuthorizationFailureReason extends string>(
    authorizationFailure: AuthorizationFailureReason | undefined,
    { deciderId, chatId, userId, decision }: {
      readonly deciderId: number;
      readonly chatId: number;
      readonly userId: number;
      readonly decision: JoinRequestDecision;
    },
  ):
    | { readonly decided: true }
    | {
      readonly decided: false;
      readonly reason: AuthorizationFailureReason | JoinRequestTargetFailureReason;
    } {
    if (authorizationFailure !== undefined) {
      return { decided: false, reason: authorizationFailure };
    }
    if (this.#sharedChats.getChatMembership(chatId, userId) !== undefined) {
      return { decided: false, reason: 'already_a_member' };
    }
    const request = this.#sharedChats.getJoinRequest(chatId, userId);
    if (request === undefined) {
      return { decided: false, reason: 'join_request_missing' };
    }

    switch (decision) {
      case 'approve':
        this.#memberships.admitAccount({
          accountId: userId,
          chatId,
          inviteLink: this.#findRequestInviteLink(request),
          approverId: deciderId,
        });
        break;
      case 'decline':
        if (!this.#sharedChats.removeJoinRequest(chatId, userId)) {
          throw new Error(`Join request of user ${userId} to chat ${chatId} vanished`);
        }
        break;
      default: {
        const unhandledDecision: never = decision;
        throw new Error(`Unhandled join request decision: ${unhandledDecision}`);
      }
    }
    return { decided: true };
  }

  /**
   * Finds the link a pending request was sent through, which the session keeps, revoked or
   * expired.
   */
  #findRequestInviteLink(request: ChatJoinRequest): ChatInviteLink {
    const inviteLink = this.#inviteLinks.findInviteLink(request.inviteLinkUrl);
    if (inviteLink === undefined) {
      throw new Error(
        `Join request of user ${request.userId} names unknown link ${request.inviteLinkUrl}`,
      );
    }
    return inviteLink;
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
      recipientBotIds: this.#sharedChats.getChatMemberIds(link.chatId).filter((memberId) =>
        this.#bots.getById(memberId) !== undefined &&
        holdsSupergroupAdministratorRight(
          this.#sharedChats.getChatMembership(link.chatId, memberId),
          'can_invite_users',
        )
      ),
      requesterContact: { status: 'open' },
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

  #describePendingRequest(request: ChatJoinRequest): PendingChatJoinRequest {
    return { request, contactBotIds: this.#listContactBotIds(request) };
  }

  /**
   * Lists the bots that may write to a pending request's user under its contact grant: while the
   * contact is open, the bots that received the request; once claimed, its claimant; and only
   * those that still hold `can_invite_users`.
   */
  #listContactBotIds(request: ChatJoinRequest): readonly number[] {
    const { requesterContact } = request;
    let permittedBotIds: readonly number[];
    switch (requesterContact.status) {
      case 'open':
        permittedBotIds = request.recipientBotIds;
        break;
      case 'claimed':
        permittedBotIds = [requesterContact.claimantBotId];
        break;
      case 'expired':
        return [];
      default: {
        const unhandledContact: never = requesterContact;
        throw new Error(`Unhandled requester contact: ${JSON.stringify(unhandledContact)}`);
      }
    }
    return permittedBotIds.filter((botId) =>
      holdsSupergroupAdministratorRight(
        this.#sharedChats.getChatMembership(request.chatId, botId),
        'can_invite_users',
      )
    );
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
