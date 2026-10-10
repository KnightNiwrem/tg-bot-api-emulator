import type { ChatPermissions } from './chat_permissions.ts';
import { isUserId } from './telegram_identity.ts';

/**
 * Identifies a private conversation by its participants, each named by its role, the account and
 * the bot, so the key is the same whichever participant addresses the conversation.
 */
export interface PrivateConversationKey {
  readonly accountId: number;
  readonly botId: number;
}

/**
 * A chat as an actor addresses it, relative to that actor: its private chat with a peer, a bot for
 * an account and an account for a bot, or a supergroup. The chat type's identity policy resolves
 * it to the `ChatKey` of the chat it names, without deciding what the actor may do there.
 */
export type ChatAddress =
  | { readonly type: 'private'; readonly peerId: number }
  | { readonly type: 'supergroup'; readonly chatId: number };

export type PrivateChatAddress = Extract<ChatAddress, { readonly type: 'private' }>;
export type SupergroupChatAddress = Extract<ChatAddress, { readonly type: 'supergroup' }>;

/**
 * A chat as an account addresses it through the control API: its private chat with a bot, by the
 * bot's ID, or a supergroup. It names the same chat as the account's `ChatAddress`, whose private
 * peer is always a bot.
 */
export type AccountChatAddress = AccountPrivateChatAddress | SupergroupChatAddress;

/** An account's private chat with a bot, as the account addresses it, by the bot's ID. */
export interface AccountPrivateChatAddress {
  readonly type: 'private';
  readonly botId: number;
}

/**
 * The chat a bot addresses by a Bot API `chat_id`: a user's ID names the bot's private chat with
 * that user, and any other ID a supergroup.
 */
export function getBotApiChatAddress(chatId: number): ChatAddress {
  return isUserId(chatId) ? { type: 'private', peerId: chatId } : { type: 'supergroup', chatId };
}

/**
 * A chat as the emulator identifies it, the same for every participant: a private conversation by
 * its participants' roles, or a supergroup by its ID.
 */
export type ChatKey =
  | { readonly type: 'private'; readonly conversation: PrivateConversationKey }
  | { readonly type: 'supergroup'; readonly chatId: number };

export type PrivateChatKey = Extract<ChatKey, { readonly type: 'private' }>;
export type SupergroupChatKey = Extract<ChatKey, { readonly type: 'supergroup' }>;

/**
 * The chat a bot addresses by a Bot API `chat_id`, as `getBotApiChatAddress` finds it, identified
 * without checking that it exists: its private conversation with the user, or the supergroup.
 */
export function getBotApiChatKey(botId: number, chatId: number): ChatKey {
  return isUserId(chatId)
    ? { type: 'private', conversation: { accountId: chatId, botId } }
    : { type: 'supergroup', chatId };
}

/**
 * What a bot shows it is doing in a chat, such as typing, by the Bot API names. `cancel` stops
 * showing an action.
 */
export type ChatAction =
  | 'cancel'
  | 'typing'
  | 'record_video'
  | 'upload_video'
  | 'record_voice'
  | 'upload_voice'
  | 'upload_photo'
  | 'upload_document'
  | 'choose_sticker'
  | 'find_location'
  | 'record_video_note'
  | 'upload_video_note';

/** A chat action a bot shows, which `cancel` is not. */
export type ShownChatActionType = Exclude<ChatAction, 'cancel'>;

/** A chat action an account's client shows: which bot shows it, and what the bot is doing. */
export interface VisibleChatAction {
  readonly botId: number;
  readonly action: ShownChatActionType;
}

/** Which participant of a private conversation, identified relative to its key. */
export type PrivateConversationRole = 'account' | 'bot';

export interface PrivateConversation extends PrivateConversationKey {
  readonly kind: 'private';
  /**
   * Telegram's `chat_instance`: an opaque signed 64-bit decimal that identifies the chat in
   * callback queries from its messages.
   */
  readonly chatInstance: string;
}

interface SharedChatBase {
  readonly id: number;
  readonly title: string;
}

export interface BasicGroup extends SharedChatBase {
  readonly kind: 'basic_group';
}

export interface Supergroup extends SharedChatBase {
  readonly kind: 'supergroup';
  /**
   * The public username that makes the supergroup public, by which bots can address it as
   * `@username`; omitted for a private supergroup. It is unique among the session's usernames,
   * compared without case.
   */
  readonly username?: string;
  readonly description?: string;
  /** Telegram's `chat_instance` of the supergroup, as `PrivateConversation` describes it. */
  readonly chatInstance: string;
  /**
   * Whether the owner protects all of the supergroup's messages from forwarding and saving, as
   * Telegram's "Restrict saving content" setting does, whoever sent them and whenever.
   */
  readonly hasProtectedContent: boolean;
  /**
   * What members may do unless a restriction of their own withholds more: the permissions that
   * Telegram's `default_banned_rights` of a supergroup does not ban. Administrators are exempt.
   */
  readonly defaultPermissions: ChatPermissions;
}

export interface Channel extends SharedChatBase {
  readonly kind: 'channel';
  readonly description?: string;
}

export type SharedChat = BasicGroup | Supergroup | Channel;

/** Creates a `chat_instance`: Telegram's chat instances look like random signed 64-bit integers. */
export function createChatInstance(): string {
  return crypto.getRandomValues(new BigInt64Array(1))[0].toString();
}
