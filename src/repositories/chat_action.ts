import type { ChatActionChat, VisibleChatAction } from '../types/virtual_chat.ts';

/** Stores the chat actions bots show in each chat, one per bot, in the order the bots sent them. */
export class ChatActionRepository {
  readonly #actionsByChatKey = new Map<string, readonly VisibleChatAction[]>();

  /** Replaces the bot's action in the chat with a newly sent one, which becomes the latest. */
  showAction(chat: ChatActionChat, shownAction: VisibleChatAction): void {
    const chatKey = serializeChatKey(chat);
    this.#actionsByChatKey.set(chatKey, [
      ...this.#withoutBotAction(chatKey, shownAction.botId),
      { ...shownAction },
    ]);
  }

  /** Removes the bot's action from the chat. Returns whether the chat showed one. */
  removeAction(chat: ChatActionChat, botId: number): boolean {
    const chatKey = serializeChatKey(chat);
    const actions = this.#actionsByChatKey.get(chatKey) ?? [];
    const remainingActions = this.#withoutBotAction(chatKey, botId);
    if (remainingActions.length === 0) {
      this.#actionsByChatKey.delete(chatKey);
    } else {
      this.#actionsByChatKey.set(chatKey, remainingActions);
    }
    return remainingActions.length < actions.length;
  }

  /** Returns the chat's actions, oldest first. */
  getActions(chat: ChatActionChat): readonly VisibleChatAction[] {
    return this.#actionsByChatKey.get(serializeChatKey(chat)) ?? [];
  }

  #withoutBotAction(chatKey: string, botId: number): readonly VisibleChatAction[] {
    return (this.#actionsByChatKey.get(chatKey) ?? []).filter((action) => action.botId !== botId);
  }
}

function serializeChatKey(chat: ChatActionChat): string {
  switch (chat.type) {
    case 'private':
      return `private:${chat.accountId}:${chat.botId}`;
    case 'supergroup':
      return `supergroup:${chat.chatId}`;
    default: {
      const unhandledChat: never = chat;
      throw new Error(`Unhandled chat action chat: ${JSON.stringify(unhandledChat)}`);
    }
  }
}
