/**
 * Sending messages, written once for every chat type: bots send messages and albums to their
 * chats, and accounts send messages, albums, inline query results, forwards and the answers of
 * reply keyboard buttons. The sending mechanics are shared; what differs per sender and chat type
 * is how the sender reaches the chat, which its chat type's policy decides, and the few checks
 * only some chats make, at the positions their order requires. `MessageCommitter` commits each
 * accepted message in its chat type's order.
 *
 * Each send is one transaction, checks included: a message, or every message of an album, is
 * committed together with its uploads, its poll and what admitting it changes, or none of it is.
 *
 * @module
 */
import {
  type ChatMembership,
  getEffectiveChatPermissions,
  type SupergroupBotAccessFailureReason,
} from '../../types/chat_membership.ts';
import type {
  ChatMessageLookup,
  PrivateChatAccessPredicates,
  PrivateChatIdentityPolicy,
  SupergroupAccessPredicates,
  SupergroupIdentityPolicy,
} from '../../types/chat_policy.ts';
import {
  type ChatPermissions,
  getContentSendPermissions,
  type PermissionGovernedContent,
} from '../../types/chat_permissions.ts';
import type { InlineKeyboard } from '../../types/inline_keyboard.ts';
import { type AlbumCompositionFailureReason, formsAlbum } from '../../types/media_album.ts';
import type { MessageForward } from '../../types/message_forward.ts';
import type { ExternalReplyTarget } from '../../types/message_reply.ts';
import type { BotMessageReplyMarkup } from '../../types/reply_interface.ts';
import type { VirtualAccount } from '../../types/virtual_account.ts';
import type { VirtualBot } from '../../types/virtual_bot.ts';
import type {
  ChatActor,
  ChatAddress,
  ChatKey,
  PrivateChatAddress,
  PrivateChatKey,
  PrivateConversation,
  PrivateConversationKey,
  Supergroup,
  SupergroupChatAddress,
  SupergroupChatKey,
} from '../../types/virtual_chat.ts';
import type {
  ChatMessage,
  MediaGroupId,
  MessageContent,
  MessageForwardInfo,
  NewSupergroupMessage,
  PrivateMessage,
  SupergroupMessage,
  WebAppDataMessageContent,
} from '../../types/virtual_message.ts';
import type { FormattedTextFixingContext } from '../../text_entities/formatted_text.ts';
import {
  type AccountAlbumMediaContent,
  type AccountMessageContent,
  type ContentNormalizationFailure,
  type ContentTextNormalizationFailure,
  type FileUploadStore,
  getReplyQuoteSource,
  hasOnlyValidButtonCallbackData,
  hasWebAppButton,
  type MediaContent,
  type NewPollStore,
  type NormalizedOutgoingContent,
  normalizeOutgoingAlbum,
  normalizeOutgoingContent,
  type OutgoingMessageContent,
  resolveReplyQuote,
  type SpecifiedQuote,
  storeOutgoingContent,
  toOutgoingAccountContent,
  toOutgoingAccountMedia,
} from './message_content.ts';
import type {
  SharedChatFailureReason,
  SharedChatResolution,
  SharedUsersFailureReason,
  SharedUsersResolution,
} from './requested_peer_sharing.ts';
import type { MessageCommitter } from './message_commit.ts';
import { createSessionUserMentionContext } from './session_user_mention.ts';

/**
 * Why a member cannot send content: it lacks a permission the content needs, as
 * `getContentSendPermissions` lists them, which Telegram reports by the kind of content.
 */
export interface SendPermissionMissingFailure {
  readonly reason: 'send_permission_missing';
  readonly contentKind: PermissionGovernedContent['kind'];
}

/** The message of the chat that a bot's message replies to. */
export interface BotMessageReplyTarget {
  /** The message's chat message ID: its ID in the bot's message box, or the supergroup's ID. */
  readonly messageId: number;
  /** Sends the message as no reply, rather than failing, when the target is not found. */
  readonly allowSendingWithoutReply: boolean;
}

/** A message a bot sends to one of its chats. */
export type BotMessage<Address extends ChatAddress> = BotMessageReplyMarkup & {
  readonly fromBotId: number;
  /** The chat as the bot addresses it: its private chat with an account, or a supergroup. */
  readonly chat: Address;
  readonly content: OutgoingMessageContent;
  /** The message of the chat it replies to; omitted for a message that replies to none. */
  readonly replyTo?: BotMessageReplyTarget;
  /**
   * The message of another chat it replies to, which the caller resolved; omitted for a message
   * that replies to none there.
   */
  readonly externalReply?: ExternalReplyTarget;
  /** The quote the bot chose from the message it replies to; omitted for none. */
  readonly quote?: SpecifiedQuote;
  /** Protects the message from forwarding and saving; omitted for an unprotected message. */
  readonly isContentProtected?: boolean;
  /** Notifies the chat without sound; omitted for a message that notifies with sound. */
  readonly isSilent?: boolean;
  /** Where the content first appeared, for a forward; omitted for other messages. */
  readonly forwardInfo?: MessageForwardInfo;
  /**
   * The album the message belongs to, as a forward or copy of an album's message, which the
   * caller issued; omitted outside albums.
   */
  readonly mediaGroupId?: MediaGroupId;
  /**
   * The message effect clients play with the message; omitted for none. Telegram allows message
   * effects only in private chats, so elsewhere a message with one is not sent.
   */
  readonly messageEffectId?: string;
};

/**
 * An album a bot sends to one of its chats. Every message of the album replies alike and shares
 * the album's protection, notification and message effect; an album carries no reply markup.
 */
export interface BotAlbum<Address extends ChatAddress> {
  readonly fromBotId: number;
  readonly chat: Address;
  /** The album's media in the order the chat shows them, each with its caption. */
  readonly contents: readonly MediaContent[];
  /** As `BotMessage` describes it. */
  readonly replyTo?: BotMessageReplyTarget;
  /** As `BotMessage` describes it. */
  readonly externalReply?: ExternalReplyTarget;
  /** As `BotMessage` describes it. */
  readonly quote?: SpecifiedQuote;
  /** As `BotMessage` describes it. */
  readonly isContentProtected?: boolean;
  /** As `BotMessage` describes it. */
  readonly isSilent?: boolean;
  /** As `BotMessage` describes it. */
  readonly messageEffectId?: string;
}

/** A message an account sends to its private chat with a bot, or to a supergroup. */
export interface AccountMessage<Address extends ChatAddress> {
  readonly fromAccountId: number;
  /** The chat as the account addresses it. */
  readonly chat: Address;
  readonly content: AccountMessageContent;
  /**
   * The chat message ID of the message to reply to: its ID in the bot's message box, by which
   * accounts address private messages, or the supergroup's ID; omitted for no reply.
   */
  readonly replyToMessageId?: number;
}

/** An album an account sends to its private chat with a bot, or to a supergroup. */
export interface AccountAlbum<Address extends ChatAddress> {
  readonly fromAccountId: number;
  readonly chat: Address;
  /** The album's media in the order the chat shows them, each with its caption. */
  readonly contents: readonly AccountAlbumMediaContent[];
  /** As `AccountMessage` describes it; every message of the album replies to it. */
  readonly replyToMessageId?: number;
}

/**
 * An inline query result that an account sends through the inline bot that offered it, which need
 * not be in the chat.
 */
export interface AccountInlineResult<Address extends ChatAddress> {
  readonly fromAccountId: number;
  readonly chat: Address;
  readonly viaBotId: number;
  /**
   * What the result sends, which Telegram checked when the bot answered: content the answer holds,
   * as `existing` content, or media downloaded from a URL, whose upload is stored with the message.
   */
  readonly content: Exclude<NormalizedOutgoingContent, { readonly kind: 'poll' }>;
  /** Omitted when the result sends no inline keyboard. */
  readonly inlineKeyboard?: InlineKeyboard;
}

/** A forward that an account sends to its private chat with a bot, or to a supergroup. */
export interface AccountForward<Address extends ChatAddress> {
  readonly fromAccountId: number;
  readonly chat: Address;
  readonly forward: MessageForward;
}

/**
 * The service message content that an account's answer to a reply keyboard button's request
 * resolves to, or why the answer is refused.
 */
export type AccountServiceContentResolution =
  | SharedUsersResolution
  | SharedChatResolution
  | { readonly resolved: true; readonly content: WebAppDataMessageContent };

/**
 * What an account's client answered a reply keyboard button's request with, which it sends to the
 * bot of its private chat as a service message, once `resolveContent` has resolved it.
 */
export interface AccountPrivateChatServiceMessage {
  readonly fromAccountId: number;
  readonly chat: PrivateChatAddress;
  /** Resolves and validates the answer, which only the reply keyboard's press does. */
  readonly resolveContent: (
    conversation: PrivateConversationKey,
  ) => AccountServiceContentResolution;
}

/**
 * The types by which one sender's messages to a chat of one type differ from the others, which
 * the sending operations report precisely: how the chat is addressed, what reaching it finds, its
 * messages, why it is not reached, the content it refuses its sender, and what it stores of a
 * message's effect.
 */
interface SendingTargetingTypes {
  readonly address: ChatAddress;
  /** The chat reached, with what deciding about the message needs to know. */
  readonly reached: { readonly key: ChatKey };
  readonly message: ChatMessage;
  /** Why the sender does not reach the chat. */
  readonly accessFailureReason: string;
  /** Why the chat refuses content its sender may not send there. */
  readonly contentRefusal: { readonly reason: string };
  /** What the chat stores of a message's effect: only private chats store one. */
  readonly effectFields: object;
}

/** The fields of a sent message, other than its chat, sender and date, that a chat commits. */
type SentMessage =
  & Omit<
    NewSupergroupMessage,
    'chat' | 'sender' | 'sentAtUnixSeconds' | 'content'
  >
  & {
    readonly content: MessageContent;
  };

/**
 * How one sender reaches a chat of one type, which content the chat refuses it, the message it
 * replies to, and how the chat admits and commits its message.
 */
interface SendingTargeting<Types extends SendingTargetingTypes> {
  /** Reaches the chat as the sender, in the chat type's order. */
  reachChat(
    senderId: number,
    chat: Types['address'],
  ):
    | ({ readonly reached: true } & Types['reached'])
    | { readonly reached: false; readonly reason: Types['accessFailureReason'] };
  /** Finds a message of the reached chat by its chat message ID. */
  findMessage(reached: Types['reached'], messageId: number): Types['message'] | undefined;
  /** Why the chat refuses the contents to the sender; `undefined` when it accepts them all. */
  findContentRefusal(
    reached: Types['reached'],
    senderId: number,
    contents: readonly (OutgoingMessageContent | NormalizedOutgoingContent)[],
  ): Types['contentRefusal'] | undefined;
  /** Prepares the chat for the sender's message that passed its checks. */
  admitMessage(reached: Types['reached']): void;
  /** Commits the sender's message, which replies to `repliedMessage` of the chat, if any. */
  commitMessage(
    reached: Types['reached'],
    senderId: number,
    message: SentMessage & Types['effectFields'],
    repliedMessage: Types['message'] | undefined,
  ): Types['message'];
}

/** The types of an account's messages to a chat of one type. */
interface AccountSendingTargetingTypes extends SendingTargetingTypes {
  /** Why the chat refuses the account an inline query result. */
  readonly inlineResultRefusal: { readonly reason: string };
}

/**
 * How an account sends to a chat of one type. Every message reaches the chat first; what the
 * message carries is checked next, then what the chat allows the account to send, then the
 * message it replies to.
 */
interface AccountSendingTargeting<Types extends AccountSendingTargetingTypes>
  extends SendingTargeting<Types> {
  /** Why the chat refuses the account an inline query result; `undefined` when it accepts it. */
  findInlineResultRefusal(
    reached: Types['reached'],
    accountId: number,
    content: NormalizedOutgoingContent,
  ): Types['inlineResultRefusal'] | undefined;
}

/** The types of a bot's messages to a chat of one type. */
interface BotSendingTargetingTypes extends SendingTargetingTypes {
  /** Why the chat refuses a message effect. */
  readonly effectRefusalReason: string;
  /** Why the chat refuses the message's inline keyboard. */
  readonly keyboardRefusalReason: string;
  /** Why the chat refuses the message once everything else about it was checked. */
  readonly lateRefusalReason: string;
}

/**
 * How a bot sends to a chat of one type. Empty text is refused before the chat is reached; the
 * replied message is looked up next, then the message effect is checked, then the content is
 * normalized and checked against what the chat allows, then its keyboard and quote, and last
 * whatever the chat checks once everything else passed.
 */
interface BotSendingTargeting<Types extends BotSendingTargetingTypes>
  extends SendingTargeting<Types> {
  /** What the chat stores of the message effect, or why it refuses one. */
  resolveMessageEffect(
    messageEffectId: string | undefined,
  ):
    | { readonly resolved: true; readonly fields: Types['effectFields'] }
    | { readonly resolved: false; readonly reason: Types['effectRefusalReason'] };
  /** Why the chat refuses the message's inline keyboard; `undefined` when it accepts it. */
  findKeyboardRefusal(
    inlineKeyboard: InlineKeyboard | undefined,
    content: NormalizedOutgoingContent,
  ): Types['keyboardRefusalReason'] | undefined;
  /** Why the chat refuses the message after every other check; `undefined` when it accepts it. */
  findLateRefusal(reached: Types['reached']): Types['lateRefusalReason'] | undefined;
}

/**
 * What lets a bot write to an account: the conversation the account started, or a pending join
 * request's contact grant.
 */
type BotRecipientAccess = 'started_conversation' | 'join_request_contact';

/** A member's standing in its supergroup, which decides what it may send there. */
interface SupergroupMemberStanding {
  readonly supergroup: Supergroup;
  readonly membership: ChatMembership;
}

/** A supergroup a member reached, with its standing there. */
interface ReachedSupergroup extends SupergroupMemberStanding {
  readonly key: SupergroupChatKey;
}

/**
 * An account reaches its private chat with an existing bot, started or not, unless it blocks the
 * bot. The chat refuses it no content.
 */
export interface AccountPrivateChatSendingTypes {
  readonly address: PrivateChatAddress;
  readonly reached: { readonly key: PrivateChatKey };
  readonly message: PrivateMessage;
  readonly accessFailureReason: 'bot_not_found' | 'bot_blocked';
  readonly contentRefusal: never;
  readonly effectFields: Record<never, never>;
  readonly inlineResultRefusal: never;
}

/**
 * An account reaches a supergroup as a member, which may send only the content its permissions
 * allow, and uses inline bots with `can_send_other_messages`.
 */
export interface AccountSupergroupSendingTypes {
  readonly address: SupergroupChatAddress;
  readonly reached: ReachedSupergroup;
  readonly message: SupergroupMessage;
  readonly accessFailureReason: 'chat_not_found' | 'not_a_member';
  readonly contentRefusal: SendPermissionMissingFailure;
  readonly effectFields: Record<never, never>;
  readonly inlineResultRefusal:
    | { readonly reason: 'inline_bots_not_permitted' }
    | SendPermissionMissingFailure;
}

/**
 * A bot reaches its private chat with an account that started it, or that a pending join request
 * lets it contact. The chat stores message effects, and refuses the bot only for the account's
 * block, which it checks last.
 */
export interface BotPrivateChatSendingTypes {
  readonly address: PrivateChatAddress;
  readonly reached: { readonly key: PrivateChatKey; readonly access: BotRecipientAccess };
  readonly message: PrivateMessage;
  readonly accessFailureReason: 'account_not_found' | 'conversation_not_started';
  readonly contentRefusal: never;
  readonly effectFields: { readonly messageEffectId?: string };
  readonly effectRefusalReason: never;
  readonly keyboardRefusalReason: never;
  readonly lateRefusalReason: 'bot_blocked';
}

/**
 * A bot reaches a supergroup as a member. As TDLib's `MessageSendOptions` does outside private
 * chats, the supergroup refuses message effects; the bot may send only the content its
 * permissions allow, and no Web App button.
 */
export interface BotSupergroupSendingTypes {
  readonly address: SupergroupChatAddress;
  readonly reached: ReachedSupergroup;
  readonly message: SupergroupMessage;
  readonly accessFailureReason: SupergroupBotAccessFailureReason;
  readonly contentRefusal: SendPermissionMissingFailure;
  readonly effectFields: Record<never, never>;
  readonly effectRefusalReason: 'message_effect_not_allowed_in_chat';
  readonly keyboardRefusalReason: 'button_type_invalid';
  readonly lateRefusalReason: never;
}

/**
 * The types of a bot's send to one of its chats, whichever chat type its address selects: the
 * private chat's or the supergroup's failures and messages.
 */
export type BotChatSendingTypes = BotPrivateChatSendingTypes | BotSupergroupSendingTypes;

export type BotMessageSendResult<Types extends BotSendingTargetingTypes> =
  | { readonly sent: true; readonly message: Types['message'] }
  | (
    & { readonly sent: false }
    & (
      | {
        readonly reason:
          | 'bot_not_found'
          | 'message_text_empty'
          | Types['accessFailureReason']
          | 'reply_message_not_found'
          | Types['effectRefusalReason']
          | 'callback_data_invalid'
          | Types['keyboardRefusalReason']
          | 'quote_invalid'
          | Types['lateRefusalReason'];
      }
      | ContentNormalizationFailure
      | Types['contentRefusal']
    )
  );

export type BotAlbumSendResult<Types extends BotSendingTargetingTypes> =
  | { readonly sent: true; readonly messages: readonly Types['message'][] }
  | (
    & { readonly sent: false }
    & (
      | {
        readonly reason:
          | 'bot_not_found'
          | Types['accessFailureReason']
          | 'reply_message_not_found'
          | Types['effectRefusalReason']
          | AlbumCompositionFailureReason
          | 'quote_invalid'
          | Types['lateRefusalReason'];
      }
      | ContentTextNormalizationFailure
      | Types['contentRefusal']
    )
  );

export type AccountMessageSendResult<Types extends AccountSendingTargetingTypes> =
  | { readonly sent: true; readonly message: Types['message'] }
  | (
    & { readonly sent: false }
    & (
      | {
        readonly reason:
          | 'account_not_found'
          | Types['accessFailureReason']
          | 'message_text_empty'
          | 'account_phone_number_missing'
          | 'reply_message_not_found';
      }
      | ContentNormalizationFailure
      | Types['contentRefusal']
    )
  );

export type AccountAlbumSendResult<Types extends AccountSendingTargetingTypes> =
  | { readonly sent: true; readonly messages: readonly Types['message'][] }
  | (
    & { readonly sent: false }
    & (
      | {
        readonly reason:
          | 'account_not_found'
          | Types['accessFailureReason']
          | AlbumCompositionFailureReason
          | 'reply_message_not_found';
      }
      | ContentTextNormalizationFailure
      | Types['contentRefusal']
    )
  );

export type AccountInlineResultSendResult<Types extends AccountSendingTargetingTypes> =
  | { readonly sent: true; readonly message: Types['message'] }
  | (
    & { readonly sent: false }
    & (
      | { readonly reason: 'account_not_found' | Types['accessFailureReason'] }
      | Types['inlineResultRefusal']
    )
  );

export type AccountForwardSendResult<Types extends AccountSendingTargetingTypes> =
  | { readonly sent: true; readonly message: Types['message'] }
  | (
    & { readonly sent: false }
    & (
      | { readonly reason: 'account_not_found' | Types['accessFailureReason'] }
      | Types['contentRefusal']
    )
  );

export type AccountPrivateChatServiceMessageSendResult =
  | { readonly sent: true; readonly message: PrivateMessage }
  | {
    readonly sent: false;
    readonly reason:
      | 'account_not_found'
      | AccountPrivateChatSendingTypes['accessFailureReason']
      | SharedUsersFailureReason
      | SharedChatFailureReason;
  };

interface AccountLookup {
  getById(accountId: number): VirtualAccount | undefined;
}

interface BotLookup {
  getById(botId: number): VirtualBot | undefined;
}

/** Starts and opens private conversations. */
interface PrivateConversationStore {
  startPrivateConversation(key: PrivateConversationKey): PrivateConversation;
  openPrivateConversation(key: PrivateConversationKey): PrivateConversation;
}

interface MediaGroupIssuing {
  createMediaGroupId(): MediaGroupId;
}

/** Commits the messages that pass their checks, each in its chat type's order. */
type ChatMessageCommitting = Pick<
  MessageCommitter,
  'commitPrivateMessage' | 'commitSupergroupMessage'
>;

/**
 * Lets a bot write to an account that has not started a private conversation with it, while a
 * pending join request of the account grants it, which chat admission grants to the bots that
 * receive the request.
 */
interface JoinRequesterContactClaims {
  /** Records that the bot wrote to the account under a grant the policy found. */
  claimJoinRequesterContact(botId: number, accountId: number): void;
}

/** The private chat policy's rules that sending asks for. */
type PrivateChatSendingPolicy =
  & PrivateChatIdentityPolicy
  & Pick<
    PrivateChatAccessPredicates,
    'isConversationStarted' | 'isBotBlocked' | 'mayBotContactJoinRequester'
  >
  & ChatMessageLookup<PrivateChatKey, PrivateMessage>;

/** The supergroup policy's rules that sending asks for. */
type SupergroupSendingPolicy =
  & SupergroupIdentityPolicy
  & SupergroupAccessPredicates
  & ChatMessageLookup<SupergroupChatKey, SupergroupMessage>;

/** The session's transactions, in which each send runs. */
interface MessageSendingTransactions {
  /** Runs a command in the transaction of the command executing, or in one of its own. */
  withinTransaction<Result>(command: () => Result): Result;
}

interface MessageSendingServiceDependencies {
  readonly accounts: AccountLookup;
  readonly bots: BotLookup;
  readonly privateChats: PrivateChatSendingPolicy;
  readonly supergroups: SupergroupSendingPolicy;
  readonly privateConversations: PrivateConversationStore;
  readonly joinRequesterContacts: JoinRequesterContactClaims;
  readonly mediaGroups: MediaGroupIssuing;
  readonly files: FileUploadStore;
  readonly polls: NewPollStore;
  readonly commits: ChatMessageCommitting;
  /** Runs each send as one transaction. */
  readonly transactions: MessageSendingTransactions;
  readonly currentUnixTimeSeconds: () => number;
}

/**
 * Sends the messages of every chat type, as Telegram does: each accepted message has its upload
 * stored, and is committed in its chat type's order.
 *
 * Bots attach inline keyboards to their messages, and show reply keyboards and forced replies to
 * accounts, which `ReplyInterfaceService` presses. Accounts send inline query results through
 * inline bots. While an account blocks a bot, neither can write to the other, as on Telegram,
 * where the bot's sends fail and a client asks the user to unblock the bot before writing to it.
 *
 * A bot's sends select their chat type's targeting by the chat's address, and an account's have
 * entry points per chat type; each reports exactly the failures its chat types can produce, in
 * Telegram's order. Results carry canonical messages; presenting them to an observer is left to
 * the caller.
 */
export class MessageSendingService {
  readonly #accounts: AccountLookup;
  readonly #bots: BotLookup;
  readonly #textFixingContext: FormattedTextFixingContext;
  readonly #supergroups: SupergroupSendingPolicy;
  readonly #mediaGroups: MediaGroupIssuing;
  readonly #files: FileUploadStore;
  readonly #polls: NewPollStore;
  readonly #commits: ChatMessageCommitting;
  readonly #transactions: MessageSendingTransactions;
  readonly #currentUnixTimeSeconds: () => number;
  readonly #accountPrivateChatTargeting: AccountSendingTargeting<AccountPrivateChatSendingTypes>;
  readonly #accountSupergroupTargeting: AccountSendingTargeting<AccountSupergroupSendingTypes>;
  readonly #botPrivateChatTargeting: BotSendingTargeting<BotPrivateChatSendingTypes>;
  readonly #botSupergroupTargeting: BotSendingTargeting<BotSupergroupSendingTypes>;

  constructor(
    {
      accounts,
      bots,
      privateChats,
      supergroups,
      privateConversations,
      joinRequesterContacts,
      mediaGroups,
      files,
      polls,
      commits,
      transactions,
      currentUnixTimeSeconds,
    }: MessageSendingServiceDependencies,
  ) {
    this.#accounts = accounts;
    this.#bots = bots;
    this.#textFixingContext = createSessionUserMentionContext({ accounts, bots });
    this.#supergroups = supergroups;
    this.#mediaGroups = mediaGroups;
    this.#files = files;
    this.#polls = polls;
    this.#commits = commits;
    this.#transactions = transactions;
    this.#currentUnixTimeSeconds = currentUnixTimeSeconds;

    const findPrivateChatMessage = (
      { key }: { readonly key: PrivateChatKey },
      messageId: number,
    ) => privateChats.findMessageByChatMessageId(key, messageId);
    const findSupergroupMessage = ({ key }: ReachedSupergroup, messageId: number) =>
      supergroups.findMessageByChatMessageId(key, messageId);
    const findSupergroupContentRefusal = (
      standing: ReachedSupergroup,
      member: ChatActor,
      contents: readonly (OutgoingMessageContent | NormalizedOutgoingContent)[],
    ) => findMissingSendPermission(standing, member, contents);

    this.#accountPrivateChatTargeting = {
      // As on Telegram, an account that blocked the bot cannot send it messages.
      reachChat: (accountId, chat) => {
        const identification = privateChats.identifyChatForAccount(accountId, chat);
        if (!identification.identified) {
          return { reached: false, reason: identification.reason };
        }
        return privateChats.isBotBlocked(identification.key)
          ? { reached: false, reason: 'bot_blocked' }
          : { reached: true, key: identification.key };
      },
      findMessage: findPrivateChatMessage,
      findContentRefusal: () => undefined,
      findInlineResultRefusal: () => undefined,
      // Any message the account writes starts the chat, even one the bot only opened.
      admitMessage: ({ key }) => {
        privateConversations.startPrivateConversation(key.conversation);
      },
      commitMessage: ({ key }, _accountId, message) =>
        this.#commits.commitPrivateMessage({
          ...message,
          chat: key,
          sender: 'account',
          sentAtUnixSeconds: this.#currentUnixTimeSeconds(),
        }),
    };
    this.#accountSupergroupTargeting = {
      reachChat: (accountId, chat) => {
        const identification = supergroups.identifyChatForAccount(accountId, chat);
        if (!identification.identified) {
          return { reached: false, reason: identification.reason };
        }
        const { key, supergroup } = identification;
        const membership = supergroups.resolveAccountMembership(accountId, supergroup);
        return membership.member
          ? { reached: true, key, supergroup, membership: membership.membership }
          : { reached: false, reason: membership.reason };
      },
      findMessage: findSupergroupMessage,
      findContentRefusal: (reached, accountId, contents) =>
        findSupergroupContentRefusal(reached, { kind: 'account', accountId }, contents),
      // As TDLib's `send_inline_query_result_message` requires, the account must be allowed to use
      // inline bots, which `can_send_other_messages` allows, and then to send the result's content.
      findInlineResultRefusal: (reached, accountId, content) => {
        const member: ChatActor = { kind: 'account', accountId };
        if (!getMemberPermissions(reached, member).has('can_send_other_messages')) {
          return { reason: 'inline_bots_not_permitted' };
        }
        return findSupergroupContentRefusal(reached, member, [content]);
      },
      admitMessage: () => {},
      commitMessage: ({ key }, accountId, message, repliedMessage) =>
        this.#commits.commitSupergroupMessage({
          ...message,
          chat: key,
          sender: { kind: 'account', accountId },
          sentAtUnixSeconds: this.#currentUnixTimeSeconds(),
        }, repliedMessage),
    };
    this.#botPrivateChatTargeting = {
      // As on Telegram, a bot cannot initiate a private conversation, so the account must have
      // started one with the bot. Otherwise, as the Bot API documents for a join request's
      // `user_chat_id`, a pending join request of the account may let the bot contact it.
      reachChat: (botId, chat) => {
        const identification = privateChats.identifyChatForBot(botId, chat);
        if (!identification.identified) {
          return { reached: false, reason: identification.reason };
        }
        const { key } = identification;
        if (privateChats.isConversationStarted(key)) {
          return { reached: true, key, access: 'started_conversation' };
        }
        return privateChats.mayBotContactJoinRequester(key)
          ? { reached: true, key, access: 'join_request_contact' }
          : { reached: false, reason: 'conversation_not_started' };
      },
      findMessage: findPrivateChatMessage,
      resolveMessageEffect: (messageEffectId) => ({
        resolved: true,
        fields: messageEffectId === undefined ? {} : { messageEffectId },
      }),
      findContentRefusal: () => undefined,
      findKeyboardRefusal: () => undefined,
      // Telegram's servers refuse a message to an account that blocks the bot only after the Bot
      // API server has checked everything it can.
      findLateRefusal: ({ key }) => privateChats.isBotBlocked(key) ? 'bot_blocked' : undefined,
      // A message under a join request's contact grant claims the contact and opens the
      // conversation, which stays unstarted, so the bot's access ends with the grant unless the
      // account writes to the bot. The grant covers sending messages only.
      admitMessage: ({ key: { conversation }, access }) => {
        if (access === 'join_request_contact') {
          joinRequesterContacts.claimJoinRequesterContact(
            conversation.botId,
            conversation.accountId,
          );
          privateConversations.openPrivateConversation(conversation);
        }
      },
      commitMessage: ({ key }, _botId, message) =>
        this.#commits.commitPrivateMessage({
          ...message,
          chat: key,
          sender: 'bot',
          sentAtUnixSeconds: this.#currentUnixTimeSeconds(),
        }),
    };
    this.#botSupergroupTargeting = {
      // A supergroup the bot is not a member of is unknown to it, as on Telegram.
      reachChat: (botId, chat) => {
        const identification = supergroups.identifyChatForBot(botId, chat);
        if (!identification.identified) {
          return { reached: false, reason: identification.reason };
        }
        const { key, supergroup } = identification;
        const membership = supergroups.resolveBotMembership(botId, supergroup);
        return membership.member
          ? { reached: true, key, supergroup, membership: membership.membership }
          : { reached: false, reason: membership.reason };
      },
      findMessage: findSupergroupMessage,
      resolveMessageEffect: (messageEffectId) =>
        messageEffectId === undefined
          ? { resolved: true, fields: {} }
          : { resolved: false, reason: 'message_effect_not_allowed_in_chat' },
      findContentRefusal: (reached, botId, contents) =>
        findSupergroupContentRefusal(reached, { kind: 'bot', botId }, contents),
      findKeyboardRefusal: (inlineKeyboard, content) =>
        hasWebAppButton(inlineKeyboard, content) ? 'button_type_invalid' : undefined,
      findLateRefusal: () => undefined,
      admitMessage: () => {},
      commitMessage: ({ key }, botId, message, repliedMessage) =>
        this.#commits.commitSupergroupMessage({
          ...message,
          chat: key,
          sender: { kind: 'bot', botId },
          sentAtUnixSeconds: this.#currentUnixTimeSeconds(),
        }, repliedMessage),
    };
  }

  /**
   * Sends text, captioned media or other content from a bot to one of its chats, its private
   * chat with an account or a supergroup it is a member of, or the content of an existing message
   * as a forward or copy of it, as `#sendBotMessage` checks it.
   */
  sendChatMessage({ chat, ...input }: BotMessage<ChatAddress>): BotMessageSendResult<
    BotChatSendingTypes
  > {
    return chat.type === 'private'
      ? this.#sendBotMessage(this.#botPrivateChatTargeting, { ...input, chat })
      : this.#sendBotMessage(this.#botSupergroupTargeting, { ...input, chat });
  }

  /** Sends a media album from a bot to one of its chats, as `#sendBotAlbum` checks it. */
  sendChatAlbum({ chat, ...input }: BotAlbum<ChatAddress>): BotAlbumSendResult<
    BotChatSendingTypes
  > {
    return chat.type === 'private'
      ? this.#sendBotAlbum(this.#botPrivateChatTargeting, { ...input, chat })
      : this.#sendBotAlbum(this.#botSupergroupTargeting, { ...input, chat });
  }

  /**
   * Whether a bot lacks a permission it needs to send content to one of its chats, as a send
   * checks it: only a supergroup restricts content, and only for a bot that is a member, as one
   * that is not fails to send for that instead.
   */
  lacksSendPermission(
    { botId, chat, content }: {
      readonly botId: number;
      readonly chat: ChatAddress;
      readonly content: OutgoingMessageContent;
    },
  ): boolean {
    if (chat.type === 'private') {
      return false;
    }
    const identification = this.#supergroups.identifyChatForBot(botId, chat);
    if (!identification.identified) {
      return false;
    }
    const membership = this.#supergroups.resolveBotMembership(botId, identification.supergroup);
    return membership.member &&
      findMissingSendPermission(
          { supergroup: identification.supergroup, membership: membership.membership },
          { kind: 'bot', botId },
          [content],
        ) !== undefined;
  }

  /**
   * Sends text, captioned media, a contact, a location, or a new poll from an account to its
   * private chat with a bot, as `#sendAccountMessage` checks it.
   */
  sendAccountPrivateChatMessage(
    input: AccountMessage<PrivateChatAddress>,
  ): AccountMessageSendResult<AccountPrivateChatSendingTypes> {
    return this.#sendAccountMessage(this.#accountPrivateChatTargeting, input);
  }

  /**
   * Sends content from an account to a supergroup it is a member of, as `#sendAccountMessage`
   * checks it; the account must be allowed to send the content, as `findMissingSendPermission`
   * decides.
   */
  sendAccountSupergroupMessage(
    input: AccountMessage<SupergroupChatAddress>,
  ): AccountMessageSendResult<AccountSupergroupSendingTypes> {
    return this.#sendAccountMessage(this.#accountSupergroupTargeting, input);
  }

  /** Sends a media album from an account to its private chat with a bot, as `#sendAccountAlbum` does. */
  sendAccountPrivateChatAlbum(
    input: AccountAlbum<PrivateChatAddress>,
  ): AccountAlbumSendResult<AccountPrivateChatSendingTypes> {
    return this.#sendAccountAlbum(this.#accountPrivateChatTargeting, input);
  }

  /** Sends a media album from an account to a supergroup it is a member of, as `#sendAccountAlbum` does. */
  sendAccountSupergroupAlbum(
    input: AccountAlbum<SupergroupChatAddress>,
  ): AccountAlbumSendResult<AccountSupergroupSendingTypes> {
    return this.#sendAccountAlbum(this.#accountSupergroupTargeting, input);
  }

  /**
   * Sends an inline query result from an account to its private chat with a bot, which receives
   * it as the account's message sent through the inline bot.
   */
  sendAccountPrivateChatInlineResult(
    input: AccountInlineResult<PrivateChatAddress>,
  ): AccountInlineResultSendResult<AccountPrivateChatSendingTypes> {
    return this.#sendAccountInlineResult(this.#accountPrivateChatTargeting, input);
  }

  /** Sends an inline query result from an account to a supergroup it is a member of. */
  sendAccountSupergroupInlineResult(
    input: AccountInlineResult<SupergroupChatAddress>,
  ): AccountInlineResultSendResult<AccountSupergroupSendingTypes> {
    return this.#sendAccountInlineResult(this.#accountSupergroupTargeting, input);
  }

  /** Sends a forward from an account to its private chat with a bot, as the account's message. */
  sendAccountPrivateChatForward(
    input: AccountForward<PrivateChatAddress>,
  ): AccountForwardSendResult<AccountPrivateChatSendingTypes> {
    return this.#sendAccountForward(this.#accountPrivateChatTargeting, input);
  }

  /**
   * Sends a forward from an account to a supergroup it is a member of, as the account's message,
   * which it must be allowed to send.
   */
  sendAccountSupergroupForward(
    input: AccountForward<SupergroupChatAddress>,
  ): AccountForwardSendResult<AccountSupergroupSendingTypes> {
    return this.#sendAccountForward(this.#accountSupergroupTargeting, input);
  }

  /**
   * Sends what an account's client answered a reply keyboard button's request with to the bot of
   * its private chat, as a service message of the account that starts the chat, once the account
   * may write to the bot and `resolveContent` resolved the answer.
   */
  sendAccountPrivateChatServiceMessage(
    { fromAccountId, chat, resolveContent }: AccountPrivateChatServiceMessage,
  ): AccountPrivateChatServiceMessageSendResult {
    return this.#transactions.withinTransaction(() => {
      if (this.#accounts.getById(fromAccountId) === undefined) {
        return { sent: false, reason: 'account_not_found' };
      }
      const targeting = this.#accountPrivateChatTargeting;
      const reach = targeting.reachChat(fromAccountId, chat);
      if (!reach.reached) {
        return { sent: false, reason: reach.reason };
      }
      const resolution = resolveContent(reach.key.conversation);
      if (!resolution.resolved) {
        return { sent: false, reason: resolution.reason };
      }
      targeting.admitMessage(reach);
      return {
        sent: true,
        message: this.#commits.commitPrivateMessage({
          chat: reach.key,
          sender: 'account',
          content: resolution.content,
          sentAtUnixSeconds: this.#currentUnixTimeSeconds(),
        }),
      };
    });
  }

  /**
   * Sends a bot's message, in Telegram's order: text is checked for emptiness before the chat is
   * reached, and the replied message is looked up after it; the chat's rule for a message effect
   * comes next. The text or caption is then normalized with its entities, and the result is
   * checked for length, then against what the chat allows the bot to send. Callback data is
   * checked next, then the chat's rule for the inline keyboard, then a quote, as Telegram's
   * servers check it, and last whatever the chat checks once everything else passed.
   */
  #sendBotMessage<Types extends BotSendingTargetingTypes>(
    targeting: BotSendingTargeting<Types>,
    input: BotMessage<Types['address']>,
  ): BotMessageSendResult<Types> {
    return this.#transactions.withinTransaction(() => {
      if (this.#bots.getById(input.fromBotId) === undefined) {
        return { sent: false, reason: 'bot_not_found' };
      }
      if (input.content.kind === 'text' && input.content.text.length === 0) {
        return { sent: false, reason: 'message_text_empty' };
      }
      const reach = targeting.reachChat(input.fromBotId, input.chat);
      if (!reach.reached) {
        return { sent: false, reason: reach.reason };
      }
      const replyResolution = this.#resolveBotReplyTarget(targeting, reach, input.replyTo);
      if (!replyResolution.resolved) {
        return { sent: false, reason: 'reply_message_not_found' };
      }
      const { repliedMessage } = replyResolution;
      const effect = targeting.resolveMessageEffect(input.messageEffectId);
      if (!effect.resolved) {
        return { sent: false, reason: effect.reason };
      }
      const contentNormalization = normalizeOutgoingContent(
        input.content,
        'bot',
        this.#textFixingContext,
      );
      if (!contentNormalization.normalized) {
        return { sent: false, ...contentNormalization.failure };
      }
      const { content } = contentNormalization;
      const contentRefusal = targeting.findContentRefusal(reach, input.fromBotId, [content]);
      if (contentRefusal !== undefined) {
        return { sent: false, ...contentRefusal };
      }
      if (!hasOnlyValidButtonCallbackData(input.inlineKeyboard, content)) {
        return { sent: false, reason: 'callback_data_invalid' };
      }
      const keyboardRefusal = targeting.findKeyboardRefusal(input.inlineKeyboard, content);
      if (keyboardRefusal !== undefined) {
        return { sent: false, reason: keyboardRefusal };
      }
      const quoteResolution = resolveReplyQuote(
        getReplyQuoteSource(repliedMessage, input.externalReply),
        input.quote,
        this.#textFixingContext,
      );
      if (!quoteResolution.resolved) {
        return { sent: false, reason: quoteResolution.reason };
      }
      const lateRefusal = targeting.findLateRefusal(reach);
      if (lateRefusal !== undefined) {
        return { sent: false, reason: lateRefusal };
      }

      targeting.admitMessage(reach);
      return {
        sent: true,
        message: targeting.commitMessage(reach, input.fromBotId, {
          ...effect.fields,
          content: storeOutgoingContent(content, this.#files, this.#polls),
          replyToMessageId: repliedMessage?.id,
          externalReply: input.externalReply?.externalReply,
          quote: quoteResolution.quote,
          inlineKeyboard: input.inlineKeyboard,
          replyInterfaceMarkup: input.replyInterfaceMarkup,
          forwardInfo: input.forwardInfo,
          mediaGroupId: input.mediaGroupId,
          isContentProtected: input.isContentProtected,
          isSilent: input.isSilent,
        }, repliedMessage),
      };
    });
  }

  /**
   * Sends a bot's media album, as `#sendBotMessage` sends one message and in its order of checks,
   * checking every message of the album before any is stored: each caption is normalized, and
   * the album is checked, as `normalizeOutgoingAlbum` does, before what the chat allows the bot
   * to send. Every message replies to the same message, with the same quote.
   */
  #sendBotAlbum<Types extends BotSendingTargetingTypes>(
    targeting: BotSendingTargeting<Types>,
    input: BotAlbum<Types['address']>,
  ): BotAlbumSendResult<Types> {
    return this.#transactions.withinTransaction(() => {
      if (this.#bots.getById(input.fromBotId) === undefined) {
        return { sent: false, reason: 'bot_not_found' };
      }
      const reach = targeting.reachChat(input.fromBotId, input.chat);
      if (!reach.reached) {
        return { sent: false, reason: reach.reason };
      }
      const replyResolution = this.#resolveBotReplyTarget(targeting, reach, input.replyTo);
      if (!replyResolution.resolved) {
        return { sent: false, reason: 'reply_message_not_found' };
      }
      const { repliedMessage } = replyResolution;
      const effect = targeting.resolveMessageEffect(input.messageEffectId);
      if (!effect.resolved) {
        return { sent: false, reason: effect.reason };
      }
      const albumNormalization = normalizeOutgoingAlbum(
        input.contents,
        'bot',
        this.#textFixingContext,
      );
      if (!albumNormalization.normalized) {
        return { sent: false, ...albumNormalization.failure };
      }
      const contentRefusal = targeting.findContentRefusal(
        reach,
        input.fromBotId,
        albumNormalization.contents,
      );
      if (contentRefusal !== undefined) {
        return { sent: false, ...contentRefusal };
      }
      const quoteResolution = resolveReplyQuote(
        getReplyQuoteSource(repliedMessage, input.externalReply),
        input.quote,
        this.#textFixingContext,
      );
      if (!quoteResolution.resolved) {
        return { sent: false, reason: quoteResolution.reason };
      }
      const lateRefusal = targeting.findLateRefusal(reach);
      if (lateRefusal !== undefined) {
        return { sent: false, reason: lateRefusal };
      }

      targeting.admitMessage(reach);
      return {
        sent: true,
        messages: this.#commitAlbum(
          targeting,
          reach,
          input.fromBotId,
          albumNormalization.contents,
          {
            ...effect.fields,
            replyToMessageId: repliedMessage?.id,
            externalReply: input.externalReply?.externalReply,
            quote: quoteResolution.quote,
            isContentProtected: input.isContentProtected,
            isSilent: input.isSilent,
          },
          repliedMessage,
        ),
      };
    });
  }

  /**
   * Sends an account's message: the account must reach the chat; then, as a Telegram client does,
   * empty text is refused, the account's own contact needs the phone number the account was
   * created with, the text or caption is normalized, which marks bot commands, and a poll is
   * checked as `normalizeNewPoll` checks it. What the chat allows the account to send is checked
   * next, then the message it replies to.
   */
  #sendAccountMessage<Types extends AccountSendingTargetingTypes>(
    targeting: AccountSendingTargeting<Types>,
    { fromAccountId, chat, content, replyToMessageId }: AccountMessage<Types['address']>,
  ): AccountMessageSendResult<Types> {
    return this.#transactions.withinTransaction(() => {
      const account = this.#accounts.getById(fromAccountId);
      if (account === undefined) {
        return { sent: false, reason: 'account_not_found' };
      }
      const reach = targeting.reachChat(fromAccountId, chat);
      if (!reach.reached) {
        return { sent: false, reason: reach.reason };
      }
      if (content.kind === 'text' && content.text.length === 0) {
        return { sent: false, reason: 'message_text_empty' };
      }
      const outgoingContent = toOutgoingAccountContent(content, account);
      if (outgoingContent === undefined) {
        return { sent: false, reason: 'account_phone_number_missing' };
      }
      const contentNormalization = normalizeOutgoingContent(
        outgoingContent,
        'account',
        this.#textFixingContext,
      );
      if (!contentNormalization.normalized) {
        return { sent: false, ...contentNormalization.failure };
      }
      const contentRefusal = targeting.findContentRefusal(reach, fromAccountId, [
        contentNormalization.content,
      ]);
      if (contentRefusal !== undefined) {
        return { sent: false, ...contentRefusal };
      }
      const repliedMessage = replyToMessageId === undefined
        ? undefined
        : targeting.findMessage(reach, replyToMessageId);
      if (replyToMessageId !== undefined && repliedMessage === undefined) {
        return { sent: false, reason: 'reply_message_not_found' };
      }

      targeting.admitMessage(reach);
      return {
        sent: true,
        message: targeting.commitMessage(reach, fromAccountId, {
          content: storeOutgoingContent(contentNormalization.content, this.#files, this.#polls),
          replyToMessageId: repliedMessage?.id,
        }, repliedMessage),
      };
    });
  }

  /**
   * Sends an account's media album, as `#sendAccountMessage` sends one message. Every message of
   * the album is checked before any is stored, as `normalizeOutgoingAlbum` checks them and then
   * what the chat allows the account to send, and every message replies to the same message. The
   * chat's bots receive each message they would receive alone, in the album's order.
   */
  #sendAccountAlbum<Types extends AccountSendingTargetingTypes>(
    targeting: AccountSendingTargeting<Types>,
    { fromAccountId, chat, contents, replyToMessageId }: AccountAlbum<Types['address']>,
  ): AccountAlbumSendResult<Types> {
    return this.#transactions.withinTransaction(() => {
      if (this.#accounts.getById(fromAccountId) === undefined) {
        return { sent: false, reason: 'account_not_found' };
      }
      const reach = targeting.reachChat(fromAccountId, chat);
      if (!reach.reached) {
        return { sent: false, reason: reach.reason };
      }
      const albumNormalization = normalizeOutgoingAlbum(
        contents.map((content) => toOutgoingAccountMedia(content)),
        'account',
        this.#textFixingContext,
      );
      if (!albumNormalization.normalized) {
        return { sent: false, ...albumNormalization.failure };
      }
      const contentRefusal = targeting.findContentRefusal(
        reach,
        fromAccountId,
        albumNormalization.contents,
      );
      if (contentRefusal !== undefined) {
        return { sent: false, ...contentRefusal };
      }
      const repliedMessage = replyToMessageId === undefined
        ? undefined
        : targeting.findMessage(reach, replyToMessageId);
      if (replyToMessageId !== undefined && repliedMessage === undefined) {
        return { sent: false, reason: 'reply_message_not_found' };
      }

      targeting.admitMessage(reach);
      return {
        sent: true,
        messages: this.#commitAlbum(
          targeting,
          reach,
          fromAccountId,
          albumNormalization.contents,
          { replyToMessageId: repliedMessage?.id },
          repliedMessage,
        ),
      };
    });
  }

  /**
   * Sends an inline query result as the account's message sent through the inline bot, once the
   * chat accepts the result from the account. Its upload, if any, is stored with the message.
   */
  #sendAccountInlineResult<Types extends AccountSendingTargetingTypes>(
    targeting: AccountSendingTargeting<Types>,
    { fromAccountId, chat, viaBotId, content, inlineKeyboard }: AccountInlineResult<
      Types['address']
    >,
  ): AccountInlineResultSendResult<Types> {
    return this.#transactions.withinTransaction(() => {
      if (this.#accounts.getById(fromAccountId) === undefined) {
        return { sent: false, reason: 'account_not_found' };
      }
      const reach = targeting.reachChat(fromAccountId, chat);
      if (!reach.reached) {
        return { sent: false, reason: reach.reason };
      }
      const refusal = targeting.findInlineResultRefusal(reach, fromAccountId, content);
      if (refusal !== undefined) {
        return { sent: false, ...refusal };
      }

      targeting.admitMessage(reach);
      return {
        sent: true,
        message: targeting.commitMessage(reach, fromAccountId, {
          content: storeOutgoingContent(content, this.#files, this.#polls),
          inlineKeyboard,
          viaBotId,
        }, undefined),
      };
    });
  }

  /** Sends a forward as the account's message, once the chat accepts its content from the account. */
  #sendAccountForward<Types extends AccountSendingTargetingTypes>(
    targeting: AccountSendingTargeting<Types>,
    { fromAccountId, chat, forward }: AccountForward<Types['address']>,
  ): AccountForwardSendResult<Types> {
    return this.#transactions.withinTransaction(() => {
      if (this.#accounts.getById(fromAccountId) === undefined) {
        return { sent: false, reason: 'account_not_found' };
      }
      const reach = targeting.reachChat(fromAccountId, chat);
      if (!reach.reached) {
        return { sent: false, reason: reach.reason };
      }
      const refusal = targeting.findContentRefusal(reach, fromAccountId, [
        { kind: 'existing', content: forward.content },
      ]);
      if (refusal !== undefined) {
        return { sent: false, ...refusal };
      }

      targeting.admitMessage(reach);
      return {
        sent: true,
        message: targeting.commitMessage(reach, fromAccountId, forward, undefined),
      };
    });
  }

  /**
   * Finds the message a bot's message replies to. As on Telegram, a target that is not found,
   * such as a deleted message, fails the send unless the bot allowed sending without a reply.
   */
  #resolveBotReplyTarget<Types extends BotSendingTargetingTypes>(
    targeting: BotSendingTargeting<Types>,
    reached: Types['reached'],
    replyTo: BotMessageReplyTarget | undefined,
  ):
    | { readonly resolved: true; readonly repliedMessage?: Types['message'] }
    | { readonly resolved: false } {
    if (replyTo === undefined) {
      return { resolved: true };
    }
    const repliedMessage = targeting.findMessage(reached, replyTo.messageId);
    if (repliedMessage !== undefined) {
      return { resolved: true, repliedMessage };
    }
    return replyTo.allowSendingWithoutReply ? { resolved: true } : { resolved: false };
  }

  /**
   * Commits the normalized contents of an album, with their uploads, one by one in order, sharing
   * a new album identifier unless the album holds a single message. Call it only once every
   * message of the album passed its checks.
   */
  #commitAlbum<Types extends SendingTargetingTypes>(
    targeting: SendingTargeting<Types>,
    reached: Types['reached'],
    senderId: number,
    contents: readonly NormalizedOutgoingContent[],
    message: Omit<SentMessage, 'content' | 'mediaGroupId'> & Types['effectFields'],
    repliedMessage: Types['message'] | undefined,
  ): readonly Types['message'][] {
    const mediaGroupId = formsAlbum(contents.length)
      ? this.#mediaGroups.createMediaGroupId()
      : undefined;
    return contents.map((content) =>
      targeting.commitMessage(reached, senderId, {
        ...message,
        content: storeOutgoingContent(content, this.#files, this.#polls),
        mediaGroupId,
      }, repliedMessage)
    );
  }
}

/** What a member may do in its supergroup, as `getEffectiveChatPermissions` decides. */
function getMemberPermissions(
  { supergroup, membership }: SupergroupMemberStanding,
  member: ChatActor,
): ChatPermissions {
  return getEffectiveChatPermissions(membership, {
    defaultPermissions: supergroup.defaultPermissions,
    isBot: member.kind === 'bot',
  });
}

/**
 * Finds the first content, in order, that a member may not send, as TDLib's
 * `can_send_message_content` checks each message, and reports its kind; `undefined` when the
 * member may send them all.
 */
export function findMissingSendPermission(
  standing: SupergroupMemberStanding,
  member: ChatActor,
  contents: readonly (OutgoingMessageContent | NormalizedOutgoingContent)[],
): SendPermissionMissingFailure | undefined {
  const permissions = getMemberPermissions(standing, member);
  for (const content of contents) {
    const governedContent = toPermissionGovernedContent(content);
    if (
      !getContentSendPermissions(governedContent).every((permission) => permissions.has(permission))
    ) {
      return { reason: 'send_permission_missing', contentKind: governedContent.kind };
    }
  }
  return undefined;
}

/** The content whose sending permissions govern, of new content or of an existing message. */
function toPermissionGovernedContent(
  content: OutgoingMessageContent | NormalizedOutgoingContent | MessageContent,
): PermissionGovernedContent {
  switch (content.kind) {
    case 'existing':
      return toPermissionGovernedContent(content.content);
    case 'rich_message':
      return {
        kind: 'rich_message',
        richMessage: 'richMessage' in content ? content.richMessage : content,
      };
    default:
      return { kind: content.kind };
  }
}
