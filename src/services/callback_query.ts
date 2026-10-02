import { getLinkBotStart } from '../text_entities/telegram_link.ts';
import { toAsciiLowerCase } from '../types/http_url.ts';
import type {
  CallbackQuery,
  CallbackQueryAnswer,
  CallbackQueryId,
} from '../types/callback_query.ts';
import type { ChatDomainEvent } from '../types/chat_domain_event.ts';
import type { VirtualAccount } from '../types/virtual_account.ts';
import type { VirtualBot } from '../types/virtual_bot.ts';
import type { ChatMembership } from '../types/chat_membership.ts';
import { listRichMessageButtons, type RichMessageButtonAction } from '../types/rich_message.ts';
import type {
  PrivateConversation,
  PrivateConversationKey,
  SharedChat,
} from '../types/virtual_chat.ts';
import {
  type CanonicalMessageId,
  type ChatMessage,
  getInlineKeyboardOwnerId,
  type InlineMessageId,
  type PrivateMessage,
  type SupergroupMessage,
} from '../types/virtual_message.ts';

/**
 * The chat of the message carrying a pressed button: the account's private chat with a bot, where
 * the bot's message box numbers messages, or a supergroup, which numbers its own messages.
 */
export type CallbackButtonChat =
  | { readonly type: 'private'; readonly botId: number }
  | { readonly type: 'supergroup'; readonly chatId: number };

export interface PressCallbackButtonInput {
  readonly fromAccountId: number;
  readonly chat: CallbackButtonChat;
  /** The ID of the message carrying the button, as the chat numbers it for its bots. */
  readonly messageId: number;
  readonly callbackData: string;
  /**
   * Creates the query already expired: the bot still receives it but cannot answer it, as when a
   * bot that was offline catches up on queries whose answer deadline has passed.
   */
  readonly expired: boolean;
}

export type PressCallbackButtonFailureReason =
  | 'account_not_found'
  | 'bot_not_found'
  | 'chat_not_found'
  | 'not_a_member'
  | 'message_not_found'
  | 'callback_button_not_found';

export type PressCallbackButtonResult =
  | { readonly pressed: true; readonly callbackQuery: CallbackQuery }
  | { readonly pressed: false; readonly reason: PressCallbackButtonFailureReason };

export interface BotCallbackQueryAnswerInput {
  readonly fromBotId: number;
  readonly callbackQueryId: CallbackQueryId;
  /** Empty text shows no notification, as omitted text does. */
  readonly text?: string;
  readonly showAlert: boolean;
  readonly cacheTimeSeconds: number;
  /** A link for the user's client to open; empty or omitted for none. */
  readonly url?: string;
}

export type BotCallbackQueryAnswerResult =
  | { readonly answered: true; readonly callbackQuery: CallbackQuery }
  | {
    readonly answered: false;
    readonly reason: 'callback_query_not_answerable' | 'url_invalid';
  };

/** Identifies a callback query by the account that created it. */
export interface AccountCallbackQueryKey {
  readonly accountId: number;
  readonly callbackQueryId: CallbackQueryId;
}

interface AccountLookup {
  getById(accountId: number): VirtualAccount | undefined;
}

interface BotLookup {
  getById(botId: number): VirtualBot | undefined;
}

interface PrivateConversationLookup {
  getPrivateConversation(key: PrivateConversationKey): PrivateConversation | undefined;
}

interface PrivateMessageLookup {
  getPrivateMessageByBotMessageId(
    conversation: PrivateConversationKey,
    botMessageId: number,
  ): PrivateMessage | undefined;
}

interface SupergroupLookup {
  getSharedChat(chatId: number): SharedChat | undefined;
  getChatMembership(chatId: number, identityId: number): ChatMembership | undefined;
}

interface SupergroupMessageLookup {
  getMessageByChatMessageId(chatId: number, messageId: number): SupergroupMessage | undefined;
}

interface CallbackQueryStore {
  addCallbackQuery(input: {
    readonly accountId: number;
    readonly botId: number;
    readonly messageId: CanonicalMessageId;
    readonly inlineMessageId?: InlineMessageId;
    readonly chatInstance: string;
    readonly callbackData: string;
    readonly expired: boolean;
  }): CallbackQuery;
  getCallbackQuery(callbackQueryId: CallbackQueryId): CallbackQuery | undefined;
  recordAnswer(callbackQueryId: CallbackQueryId, answer: CallbackQueryAnswer): CallbackQuery;
}

interface ChatDomainEventSink {
  publish(event: ChatDomainEvent): void;
}

interface CallbackQueryServiceDependencies {
  readonly accounts: AccountLookup;
  readonly bots: BotLookup;
  readonly privateConversations: PrivateConversationLookup;
  readonly privateMessages: PrivateMessageLookup;
  readonly sharedChats: SupergroupLookup;
  readonly supergroupMessages: SupergroupMessageLookup;
  readonly callbackQueries: CallbackQueryStore;
  readonly events: ChatDomainEventSink;
}

/** A message found in the chat where an account presses one of its buttons. */
type PressedMessageResolution =
  | {
    readonly resolved: true;
    readonly message: ChatMessage;
    readonly chatInstance: string;
  }
  | {
    readonly resolved: false;
    readonly reason: Exclude<PressCallbackButtonFailureReason, 'account_not_found'>;
  };

/**
 * Carries out callback queries: an account presses a callback button on a bot's message, or on a
 * message sent through a bot's inline mode, and the bot answers once with an optional notification
 * for the account. A press can create the query already expired; the emulator does not otherwise
 * expire queries by time.
 */
export class CallbackQueryService {
  readonly #accounts: AccountLookup;
  readonly #bots: BotLookup;
  readonly #privateConversations: PrivateConversationLookup;
  readonly #privateMessages: PrivateMessageLookup;
  readonly #sharedChats: SupergroupLookup;
  readonly #supergroupMessages: SupergroupMessageLookup;
  readonly #callbackQueries: CallbackQueryStore;
  readonly #events: ChatDomainEventSink;

  constructor(
    {
      accounts,
      bots,
      privateConversations,
      privateMessages,
      sharedChats,
      supergroupMessages,
      callbackQueries,
      events,
    }: CallbackQueryServiceDependencies,
  ) {
    this.#accounts = accounts;
    this.#bots = bots;
    this.#privateConversations = privateConversations;
    this.#privateMessages = privateMessages;
    this.#sharedChats = sharedChats;
    this.#supergroupMessages = supergroupMessages;
    this.#callbackQueries = callbackQueries;
    this.#events = events;
  }

  /**
   * Presses the callback button with the given data, in the inline keyboard or the rich message of
   * a message of the account's private chat with a bot or of a supergroup the account is a member
   * of, and publishes the resulting callback query for the bot whose buttons the message carries. As on Telegram, the inline bot of a
   * message sent through it knows the message only by its inline message identifier.
   */
  pressCallbackButton(input: PressCallbackButtonInput): PressCallbackButtonResult {
    if (this.#accounts.getById(input.fromAccountId) === undefined) {
      return { pressed: false, reason: 'account_not_found' };
    }
    const resolution = input.chat.type === 'private'
      ? this.#resolvePrivateChatMessage(input.fromAccountId, input.chat.botId, input.messageId)
      : this.#resolveSupergroupMessage(input.fromAccountId, input.chat.chatId, input.messageId);
    if (!resolution.resolved) {
      return { pressed: false, reason: resolution.reason };
    }
    const { message } = resolution;
    const botId = getInlineKeyboardOwnerId(message);
    if (botId === undefined || !hasCallbackButton(message, input.callbackData)) {
      return { pressed: false, reason: 'callback_button_not_found' };
    }

    const callbackQuery = this.#callbackQueries.addCallbackQuery({
      accountId: input.fromAccountId,
      botId,
      messageId: message.id,
      inlineMessageId: message.viaBot?.inlineMessageId,
      chatInstance: resolution.chatInstance,
      callbackData: input.callbackData,
      expired: input.expired,
    });
    this.#events.publish({ type: 'callback_query_created', callbackQuery, message });
    return { pressed: true, callbackQuery };
  }

  /**
   * Records the bot's answer to a callback query it received. As on Telegram, a query that does
   * not exist, belongs to another bot, is already answered, or has expired cannot be answered.
   *
   * The Bot API documents two kinds of URL for an answer: a game's URL, for a button that opens a
   * game, and a link like `t.me/<bot_username>?start=<parameter>`. The emulator has no game
   * buttons, so it accepts only links that start the answering bot, which Telegram's servers
   * check beyond the open-source code; other URLs are rejected, as Telegram rejects URLs it does
   * not allow.
   */
  answerCallbackQuery(input: BotCallbackQueryAnswerInput): BotCallbackQueryAnswerResult {
    const callbackQuery = this.#callbackQueries.getCallbackQuery(input.callbackQueryId);
    if (
      callbackQuery === undefined ||
      callbackQuery.botId !== input.fromBotId ||
      callbackQuery.state.status !== 'awaiting_answer'
    ) {
      return { answered: false, reason: 'callback_query_not_answerable' };
    }
    const url = input.url === undefined || input.url.length === 0 ? undefined : input.url;
    if (url !== undefined && !this.#isStartLinkOfBot(url, input.fromBotId)) {
      return { answered: false, reason: 'url_invalid' };
    }

    return {
      answered: true,
      callbackQuery: this.#callbackQueries.recordAnswer(callbackQuery.id, {
        ...(input.text === undefined || input.text.length === 0 ? {} : { text: input.text }),
        showAlert: input.showAlert,
        cacheTimeSeconds: input.cacheTimeSeconds,
        ...(url === undefined ? {} : { url }),
      }),
    };
  }

  /** Whether a link starts the bot with a parameter; usernames match regardless of case. */
  #isStartLinkOfBot(url: string, botId: number): boolean {
    const startLink = getLinkBotStart(url);
    const botUsername = this.#bots.getById(botId)?.profile.username;
    return startLink !== undefined && botUsername !== undefined &&
      toAsciiLowerCase(startLink.username) === toAsciiLowerCase(botUsername);
  }

  /** Returns a callback query the account created, or `undefined` for any other query. */
  getAccountCallbackQuery(
    { accountId, callbackQueryId }: AccountCallbackQueryKey,
  ): CallbackQuery | undefined {
    const callbackQuery = this.#callbackQueries.getCallbackQuery(callbackQueryId);
    return callbackQuery?.accountId === accountId ? callbackQuery : undefined;
  }

  #resolvePrivateChatMessage(
    accountId: number,
    botId: number,
    botMessageId: number,
  ): PressedMessageResolution {
    if (this.#bots.getById(botId) === undefined) {
      return { resolved: false, reason: 'bot_not_found' };
    }
    const conversationKey: PrivateConversationKey = { accountId, botId };
    const conversation = this.#privateConversations.getPrivateConversation(conversationKey);
    const message = conversation === undefined
      ? undefined
      : this.#privateMessages.getPrivateMessageByBotMessageId(conversationKey, botMessageId);
    if (conversation === undefined || message === undefined) {
      return { resolved: false, reason: 'message_not_found' };
    }
    return { resolved: true, message, chatInstance: conversation.chatInstance };
  }

  #resolveSupergroupMessage(
    accountId: number,
    chatId: number,
    messageId: number,
  ): PressedMessageResolution {
    const supergroup = this.#sharedChats.getSharedChat(chatId);
    if (supergroup?.kind !== 'supergroup') {
      return { resolved: false, reason: 'chat_not_found' };
    }
    if (this.#sharedChats.getChatMembership(chatId, accountId) === undefined) {
      return { resolved: false, reason: 'not_a_member' };
    }
    const message = this.#supergroupMessages.getMessageByChatMessageId(chatId, messageId);
    if (message === undefined) {
      return { resolved: false, reason: 'message_not_found' };
    }
    return { resolved: true, message, chatInstance: supergroup.chatInstance };
  }
}

/** Whether a message has a callback button with the data, in its inline keyboard or rich message. */
function hasCallbackButton(message: ChatMessage, callbackData: string): boolean {
  const isPressedButton = (action: RichMessageButtonAction) =>
    action.kind === 'callback' && action.callbackData === callbackData;
  return (message.inlineKeyboard?.some((row) => row.some(isPressedButton)) ?? false) ||
    (message.content.kind === 'rich_message' &&
      listRichMessageButtons(message.content).some(({ action }) => isPressedButton(action)));
}
