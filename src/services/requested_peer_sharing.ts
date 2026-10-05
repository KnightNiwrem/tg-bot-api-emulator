import type {
  ChatAdministratorRightName,
  DefaultAdministratorRights,
} from '../types/bot_default_administrator_rights.ts';
import {
  type ChatMembership,
  holdsEverySupergroupAdministratorRight,
  SUPERGROUP_ADMINISTRATOR_RIGHTS,
  type SupergroupAdministratorRight,
} from '../types/chat_membership.ts';
import type {
  ReplyKeyboardChatRequest,
  ReplyKeyboardUsersRequest,
} from '../types/reply_interface.ts';
import type { PrivateConversationKey, SharedChat, Supergroup } from '../types/virtual_chat.ts';
import type {
  ChatSharedMessageContent,
  SharedUser,
  UsersSharedMessageContent,
} from '../types/virtual_message.ts';

/**
 * Why the emulator cannot answer a request at all: it asks for Premium users, a channel, a forum,
 * or an anonymous administrator, none of which the emulator models, so no choice satisfies it.
 */
type UnmodeledRequestFailureReason = 'reply_keyboard_button_request_unsupported';

/**
 * Why the users an account chose do not answer a `request_users` button, as TDLib's
 * `RequestedDialogType::check_shared_dialog_count` and `check_shared_dialog` refuse them.
 */
export type SharedUsersFailureReason =
  | UnmodeledRequestFailureReason
  /** No user at all: "Too few chats are chosen". */
  | 'shared_users_too_few'
  /** More users than the request's `max_quantity`: "Too many chats are chosen". */
  | 'shared_users_too_many'
  /** The same user chosen twice, which the emulator refuses. */
  | 'shared_users_duplicated'
  /** No account or bot of the session has the ID. */
  | 'shared_user_not_found'
  /** A user, or a bot, where the request requires the other: "Wrong is_bot value". */
  | 'shared_user_kind_mismatch';

/**
 * Why the chat an account chose does not answer a `request_chat` button, as TDLib's
 * `RequestedDialogType::check_shared_dialog` refuses it, or, for the bot's membership and rights,
 * which Telegram's clients would grant, as the emulator requires them to exist already.
 */
export type SharedChatFailureReason =
  | UnmodeledRequestFailureReason
  /** No supergroup of the session has the ID. */
  | 'shared_chat_not_found'
  /** The account is not a member of the supergroup, which the emulator requires of a shared chat. */
  | 'shared_chat_not_joined'
  /** A public chat where the request requires a private one, or the reverse. */
  | 'shared_chat_username_mismatch'
  /** The account does not own the supergroup the request requires it to have created. */
  | 'shared_chat_not_created'
  /** The account lacks administrator rights the request requires: "Not enough rights". */
  | 'user_administrator_rights_missing'
  /** The bot is not a member where the request requires it to be. */
  | 'bot_not_member'
  /** The bot lacks administrator rights the request requires it to hold. */
  | 'bot_administrator_rights_missing';

export type SharedUsersResolution =
  | { readonly resolved: true; readonly content: UsersSharedMessageContent }
  | { readonly resolved: false; readonly reason: SharedUsersFailureReason };

export type SharedChatResolution =
  | { readonly resolved: true; readonly content: ChatSharedMessageContent }
  | { readonly resolved: false; readonly reason: SharedChatFailureReason };

/** The details of an account's or bot's profile that sharing the user reads. */
interface SharedUserProfile {
  readonly is_bot: boolean;
  readonly first_name: string;
  readonly last_name?: string;
  readonly username?: string;
}

/** Finds an account or a bot of the session by its ID. */
interface SharedUserLookup {
  getById(userId: number): { readonly profile: SharedUserProfile } | undefined;
}

/** Finds the session's users and supergroups that an account can share with a bot. */
export interface SharedPeerLookups {
  readonly accounts: SharedUserLookup;
  readonly bots: SharedUserLookup;
  readonly sharedChats: {
    getSharedChat(chatId: number): SharedChat | undefined;
    /** Returns a current member's standing; `undefined` for anyone else. */
    getChatMembership(chatId: number, identityId: number): ChatMembership | undefined;
  };
}

/**
 * Resolves the users an account chooses in answer to a `request_users` button into the service
 * message that shares them: any accounts and bots of the session, in the order chosen, with the
 * names and usernames the request asks for as they are now. The emulator has no profile photos, so
 * no shared user shows one.
 *
 * As TDLib's `RequestedDialogType::check_shared_dialog_count` does, no users or more users than
 * `max_quantity` are refused, and as its `check_shared_dialog` does, so is a user of the wrong
 * kind. Emulated accounts are never Premium users, as the Bot API shows them, so a request that
 * requires Premium users cannot be answered. TDLib passes repeated users on to Telegram, whose
 * handling of them is unknown; the emulator refuses them.
 */
export function resolveSharedUsers(
  request: ReplyKeyboardUsersRequest,
  userIds: readonly number[],
  { accounts, bots }: Pick<SharedPeerLookups, 'accounts' | 'bots'>,
): SharedUsersResolution {
  if (request.userIsPremium === true) {
    return { resolved: false, reason: 'reply_keyboard_button_request_unsupported' };
  }
  if (userIds.length === 0) {
    return { resolved: false, reason: 'shared_users_too_few' };
  }
  if (userIds.length > request.maxQuantity) {
    return { resolved: false, reason: 'shared_users_too_many' };
  }
  if (new Set(userIds).size !== userIds.length) {
    return { resolved: false, reason: 'shared_users_duplicated' };
  }
  const users: SharedUser[] = [];
  for (const userId of userIds) {
    const profile = accounts.getById(userId)?.profile ?? bots.getById(userId)?.profile;
    if (profile === undefined) {
      return { resolved: false, reason: 'shared_user_not_found' };
    }
    if (request.userIsBot !== undefined && profile.is_bot !== request.userIsBot) {
      return { resolved: false, reason: 'shared_user_kind_mismatch' };
    }
    users.push(describeSharedUser(userId, profile, request));
  }
  return { resolved: true, content: { kind: 'users_shared', requestId: request.requestId, users } };
}

/** A shared user with the details of its profile that the request asks for and it has. */
function describeSharedUser(
  userId: number,
  { first_name, last_name, username }: SharedUserProfile,
  { requestsName, requestsUsername }: ReplyKeyboardUsersRequest,
): SharedUser {
  return {
    userId,
    ...(requestsName ? { firstName: first_name } : {}),
    ...(requestsName && last_name !== undefined ? { lastName: last_name } : {}),
    ...(requestsUsername && username !== undefined ? { username } : {}),
  };
}

/**
 * Resolves the chat an account chooses in answer to a `request_chat` button into the service
 * message that shares it: a supergroup of the session the account is a member of, with the title
 * and username the request asks for as they are now. The emulator has no chat photos, so the
 * shared chat shows none.
 *
 * The supergroup must meet the request's criteria as TDLib's
 * `RequestedDialogType::check_shared_dialog` checks them for a supergroup, which skips the
 * account's rights when the request requires a chat it created. Telegram's clients add or promote
 * the bot when the request requires its membership or rights; the emulator grants neither, so the
 * bot must already be a member that holds the rights. Sharing the chat grants nobody anything. A
 * request for a channel, a forum, or anonymous administrator rights cannot be answered, since the
 * emulator models none of them.
 */
export function resolveSharedChat(
  request: ReplyKeyboardChatRequest,
  chatId: number,
  { accountId, botId }: PrivateConversationKey,
  { sharedChats }: Pick<SharedPeerLookups, 'sharedChats'>,
): SharedChatResolution {
  if (requiresUnmodeledChat(request)) {
    return { resolved: false, reason: 'reply_keyboard_button_request_unsupported' };
  }
  const chat = sharedChats.getSharedChat(chatId);
  if (chat?.kind !== 'supergroup') {
    return { resolved: false, reason: 'shared_chat_not_found' };
  }
  const accountMembership = sharedChats.getChatMembership(chatId, accountId);
  if (accountMembership === undefined) {
    return { resolved: false, reason: 'shared_chat_not_joined' };
  }
  const unmetCriterion = findUnmetChatCriterion(request, {
    chat,
    accountMembership,
    botMembership: sharedChats.getChatMembership(chatId, botId),
  });
  if (unmetCriterion !== undefined) {
    return { resolved: false, reason: unmetCriterion };
  }
  return {
    resolved: true,
    content: {
      kind: 'chat_shared',
      requestId: request.requestId,
      chatId,
      ...(request.requestsTitle ? { title: chat.title } : {}),
      ...(request.requestsUsername && chat.username !== undefined
        ? { username: chat.username }
        : {}),
    },
  };
}

/**
 * Finds the first criterion of a chat request that a supergroup the account is a member of does
 * not meet, in the order TDLib's `check_shared_dialog` checks them; `undefined` when it meets all.
 */
function findUnmetChatCriterion(
  request: ReplyKeyboardChatRequest,
  { chat, accountMembership, botMembership }: {
    readonly chat: Supergroup;
    readonly accountMembership: ChatMembership;
    /** `undefined` when the bot is not a member. */
    readonly botMembership: ChatMembership | undefined;
  },
):
  | Exclude<SharedChatFailureReason, 'shared_chat_not_found' | 'shared_chat_not_joined'>
  | undefined {
  if (
    request.chatHasUsername !== undefined &&
    (chat.username !== undefined) !== request.chatHasUsername
  ) {
    return 'shared_chat_username_mismatch';
  }
  if (request.chatIsCreated && accountMembership.status !== 'owner') {
    return 'shared_chat_not_created';
  }
  if (
    !request.chatIsCreated && request.userAdministratorRights !== undefined &&
    !holdsAdministratorRights(accountMembership, request.userAdministratorRights)
  ) {
    return 'user_administrator_rights_missing';
  }
  if (request.botIsMember && botMembership === undefined) {
    return 'bot_not_member';
  }
  if (
    request.botAdministratorRights !== undefined &&
    !holdsAdministratorRights(botMembership, request.botAdministratorRights)
  ) {
    return 'bot_administrator_rights_missing';
  }
  return undefined;
}

/**
 * Whether a chat request requires what the emulator does not model: a channel, a forum, or an
 * administrator that is anonymous, which the account's rights need only when the request does not
 * require a chat the account created.
 */
function requiresUnmodeledChat(request: ReplyKeyboardChatRequest): boolean {
  return request.chatIsChannel || request.chatIsForum === true ||
    (!request.chatIsCreated && request.userAdministratorRights?.has('is_anonymous') === true) ||
    request.botAdministratorRights?.has('is_anonymous') === true;
}

const SUPERGROUP_ADMINISTRATOR_RIGHT_SET: ReadonlySet<string> = new Set(
  SUPERGROUP_ADMINISTRATOR_RIGHTS,
);

function isSupergroupAdministratorRight(
  right: ChatAdministratorRightName,
): right is SupergroupAdministratorRight {
  return SUPERGROUP_ADMINISTRATOR_RIGHT_SET.has(right);
}

/**
 * Whether a supergroup member holds every required right, as TDLib's
 * `DialogParticipantStatus::has_all_administrator_rights` decides; the owner holds every right a
 * supergroup has, and a non-member holds none.
 */
function holdsAdministratorRights(
  membership: ChatMembership | undefined,
  requiredRights: DefaultAdministratorRights,
): boolean {
  const requiredSupergroupRights = [...requiredRights].filter(isSupergroupAdministratorRight);
  return requiredSupergroupRights.length === requiredRights.size &&
    holdsEverySupergroupAdministratorRight(membership, new Set(requiredSupergroupRights));
}
