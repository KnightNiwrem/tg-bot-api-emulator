import type { ChatMembership } from '../types/chat_membership.ts';
import type { VirtualAccount } from '../types/virtual_account.ts';
import type { VirtualBot } from '../types/virtual_bot.ts';
import type {
  ChatAction,
  ChatActionChat,
  PrivateConversationKey,
  SharedChat,
  VisibleChatAction,
} from '../types/virtual_chat.ts';

/** Why an account cannot see the chat actions of a chat. */
type ChatActionsLookupFailureReason =
  | 'account_not_found'
  | 'bot_not_found'
  | 'chat_not_found'
  | 'not_a_member';

export type GetChatActionsResult =
  | { readonly found: true; readonly chatActions: readonly VisibleChatAction[] }
  | { readonly found: false; readonly reason: ChatActionsLookupFailureReason };

export type ExpireChatActionResult =
  | { readonly expired: true }
  | {
    readonly expired: false;
    readonly reason: ChatActionsLookupFailureReason | 'chat_action_not_found';
  };

/** Identifies a supergroup as one of its members sees it. */
export interface SupergroupChatActionsKey {
  readonly accountId: number;
  readonly chatId: number;
}

/** Identifies the chat action one bot shows in a supergroup, as one of its members sees it. */
export interface SupergroupBotChatActionKey extends SupergroupChatActionsKey {
  readonly botId: number;
}

interface AccountLookup {
  getById(accountId: number): VirtualAccount | undefined;
}

interface BotLookup {
  getById(botId: number): VirtualBot | undefined;
}

interface SupergroupMembershipLookup {
  getSharedChat(chatId: number): SharedChat | undefined;
  getChatMembership(chatId: number, identityId: number): ChatMembership | undefined;
}

interface ChatActionStore {
  showAction(chat: ChatActionChat, shownAction: VisibleChatAction): void;
  removeAction(chat: ChatActionChat, botId: number): boolean;
  getActions(chat: ChatActionChat): readonly VisibleChatAction[];
}

interface ChatActionServiceDependencies {
  readonly accounts: AccountLookup;
  readonly bots: BotLookup;
  readonly sharedChats: SupergroupMembershipLookup;
  readonly chatActions: ChatActionStore;
}

type ChatActionChatLookup =
  | { readonly found: true; readonly chat: ChatActionChat }
  | { readonly found: false; readonly reason: ChatActionsLookupFailureReason };

/**
 * Keeps the chat actions, such as typing, that bots show in their chats, as accounts' clients see
 * them through TDLib's `DialogActionManager`. A bot's action shows until it cancels it, until the
 * bot sends a message to the chat, which ends any action of a bot, or until a test expires it.
 *
 * Telegram's clients also stop showing an action 5.5 seconds after the bot last sent it. The
 * emulator never ends one as time passes, so what a test reads does not depend on how long it
 * took: the test expires the action at the point in its scenario it chooses.
 *
 * Callers check that the bot may send the action to the chat before recording it.
 */
export class ChatActionService {
  readonly #accounts: AccountLookup;
  readonly #bots: BotLookup;
  readonly #sharedChats: SupergroupMembershipLookup;
  readonly #chatActions: ChatActionStore;

  constructor({ accounts, bots, sharedChats, chatActions }: ChatActionServiceDependencies) {
    this.#accounts = accounts;
    this.#bots = bots;
    this.#sharedChats = sharedChats;
    this.#chatActions = chatActions;
  }

  /** Records a chat action a bot sent to a chat; `cancel` stops showing the bot's action. */
  recordBotChatAction(
    { botId, chat, action }: {
      readonly botId: number;
      readonly chat: ChatActionChat;
      readonly action: ChatAction;
    },
  ): void {
    if (action === 'cancel') {
      this.#chatActions.removeAction(chat, botId);
      return;
    }
    this.#chatActions.showAction(chat, { botId, action });
  }

  /** Ends the chat action of a bot that sent a message to the chat. */
  endBotChatAction({ botId, chat }: { readonly botId: number; readonly chat: ChatActionChat }) {
    this.#chatActions.removeAction(chat, botId);
  }

  /** Returns the chat action an account's client shows in its private chat with a bot. */
  getPrivateChatActions(key: PrivateConversationKey): GetChatActionsResult {
    return this.#getChatActions(this.#findPrivateChat(key));
  }

  /**
   * Returns the chat actions a member's client shows in a supergroup, in the order the bots last
   * sent them.
   */
  getSupergroupChatActions(key: SupergroupChatActionsKey): GetChatActionsResult {
    return this.#getChatActions(this.#findSupergroupChat(key));
  }

  /**
   * Stops showing the chat action an account's client shows in its private chat with a bot, as
   * Telegram's clients do once the action times out. The bot is not told, and its next action
   * shows again.
   */
  expirePrivateChatAction(key: PrivateConversationKey): ExpireChatActionResult {
    return this.#expireChatAction(this.#findPrivateChat(key), key.botId);
  }

  /**
   * Stops showing one bot's chat action in a supergroup, as a member's client does once the action
   * times out. Other bots' actions stay; the bot is not told, and its next action shows again.
   */
  expireSupergroupChatAction(
    { accountId, chatId, botId }: SupergroupBotChatActionKey,
  ): ExpireChatActionResult {
    const lookup = this.#findSupergroupChat({ accountId, chatId });
    if (lookup.found && this.#bots.getById(botId) === undefined) {
      return { expired: false, reason: 'bot_not_found' };
    }
    return this.#expireChatAction(lookup, botId);
  }

  #getChatActions(lookup: ChatActionChatLookup): GetChatActionsResult {
    return lookup.found
      ? { found: true, chatActions: this.#chatActions.getActions(lookup.chat) }
      : lookup;
  }

  #expireChatAction(lookup: ChatActionChatLookup, botId: number): ExpireChatActionResult {
    if (!lookup.found) {
      return { expired: false, reason: lookup.reason };
    }
    return this.#chatActions.removeAction(lookup.chat, botId)
      ? { expired: true }
      : { expired: false, reason: 'chat_action_not_found' };
  }

  #findPrivateChat({ accountId, botId }: PrivateConversationKey): ChatActionChatLookup {
    if (this.#accounts.getById(accountId) === undefined) {
      return { found: false, reason: 'account_not_found' };
    }
    if (this.#bots.getById(botId) === undefined) {
      return { found: false, reason: 'bot_not_found' };
    }
    return { found: true, chat: { type: 'private', accountId, botId } };
  }

  #findSupergroupChat({ accountId, chatId }: SupergroupChatActionsKey): ChatActionChatLookup {
    if (this.#accounts.getById(accountId) === undefined) {
      return { found: false, reason: 'account_not_found' };
    }
    if (this.#sharedChats.getSharedChat(chatId)?.kind !== 'supergroup') {
      return { found: false, reason: 'chat_not_found' };
    }
    if (this.#sharedChats.getChatMembership(chatId, accountId) === undefined) {
      return { found: false, reason: 'not_a_member' };
    }
    return { found: true, chat: { type: 'supergroup', chatId } };
  }
}
