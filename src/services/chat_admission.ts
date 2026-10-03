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
  | { readonly joined: true; readonly chatId: number }
  | {
    readonly joined: false;
    readonly reason:
      | SelfJoinFailureReason
      /** No link of the session has this URL. */
      | 'invite_link_not_found'
      /** A test made the link's expiry date arrive. */
      | 'invite_link_expired'
      /** As many users as the link's member limit allows joined through it and are members. */
      | 'invite_link_member_limit_reached'
      /** The link creates join requests, which the emulator does not support yet. */
      | 'join_requests_unsupported';
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
}

export type GetInviteLinksForAccountResult =
  | {
    readonly found: true;
    /** The chat's links in the order they were created. */
    readonly links: readonly ChatInviteLinkUsage[];
  }
  | {
    readonly found: false;
    readonly reason: 'account_not_found' | 'chat_not_found' | 'not_the_owner';
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

interface ChatMembershipLookup extends SupergroupMembershipLookup {
  countMembersJoinedByInviteLink(chatId: number, inviteLinkUrl: string): number;
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
    },
  ): void;
}

interface ChatAdmissionServiceDependencies {
  readonly accounts: AccountLookup;
  readonly bots: BotLookup;
  readonly sharedChats: ChatMembershipLookup;
  readonly inviteLinks: ChatInviteLinkStore;
  /** Adds the accounts that may join, publishing and recording each join. */
  readonly memberships: AccountAdmission;
  /** The time an invite link's expiry date must lie after. */
  readonly currentUnixTimeSeconds: () => number;
}

/**
 * Decides who may enter a supergroup without its owner adding them: administrator bots create
 * additional invite links, and accounts join through them, or by the username of a public
 * supergroup. A link keeps its creator, its expiry date, its member limit, and whether it creates
 * join requests. Its expiry date arrives only when a test makes it arrive, so tests decide when a
 * link stops working.
 */
export class ChatAdmissionService {
  readonly #accounts: AccountLookup;
  readonly #bots: BotLookup;
  readonly #sharedChats: ChatMembershipLookup;
  readonly #inviteLinks: ChatInviteLinkStore;
  readonly #memberships: AccountAdmission;
  readonly #currentUnixTimeSeconds: () => number;

  constructor(
    { accounts, bots, sharedChats, inviteLinks, memberships, currentUnixTimeSeconds }:
      ChatAdmissionServiceDependencies,
  ) {
    this.#accounts = accounts;
    this.#bots = bots;
    this.#sharedChats = sharedChats;
    this.#inviteLinks = inviteLinks;
    this.#memberships = memberships;
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
   * Lets an account join a supergroup through an invite link, as TDLib's `joinChatByInviteLink`
   * asks Telegram's servers to: the link must be one of the session's, its expiry date must not
   * have arrived, and its member limit must leave a place, counting the members that joined
   * through it and still are. The account must be neither a member nor banned; a restricted user
   * joins with its restriction. The membership remembers the link, which the chat's administrator
   * bots see in the `chat_member` update.
   */
  joinChatByInviteLink(
    { accountId, inviteLinkUrl }: JoinChatByInviteLinkInput,
  ): JoinChatByInviteLinkResult {
    if (this.#accounts.getById(accountId) === undefined) {
      return { joined: false, reason: 'account_not_found' };
    }
    const link = this.#inviteLinks.findInviteLink(inviteLinkUrl);
    if (link === undefined) {
      return { joined: false, reason: 'invite_link_not_found' };
    }
    if (link.hasExpired) {
      return { joined: false, reason: 'invite_link_expired' };
    }
    if (
      link.memberLimit !== undefined &&
      this.#sharedChats.countMembersJoinedByInviteLink(link.chatId, link.url) >= link.memberLimit
    ) {
      return { joined: false, reason: 'invite_link_member_limit_reached' };
    }
    const standingFailure = this.#findSelfJoinStandingFailure(link.chatId, accountId);
    if (standingFailure !== undefined) {
      return { joined: false, reason: standingFailure };
    }
    if (link.createsJoinRequest) {
      return { joined: false, reason: 'join_requests_unsupported' };
    }

    this.#memberships.admitAccount({ accountId, chatId: link.chatId, inviteLink: link });
    return { joined: true, chatId: link.chatId };
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
    if (this.#accounts.getById(accountId) === undefined) {
      return { found: false, reason: 'account_not_found' };
    }
    if (this.#sharedChats.getSharedChat(chatId)?.kind !== 'supergroup') {
      return { found: false, reason: 'chat_not_found' };
    }
    if (this.#sharedChats.getChatMembership(chatId, accountId)?.status !== 'owner') {
      return { found: false, reason: 'not_the_owner' };
    }
    return {
      found: true,
      links: this.#inviteLinks.listChatInviteLinks(chatId).map((link) => this.#describeUsage(link)),
    };
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
    };
  }
}
