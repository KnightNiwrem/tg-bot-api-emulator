import type { ChatIdentification } from '../../types/chat_policy.ts';
import type { VirtualBot } from '../../types/virtual_bot.ts';
import {
  type BotToBotPrivateChatKey,
  getBotToBotConversationKey,
  type PrivateChatAddress,
} from '../../types/virtual_chat.ts';
import type { BotToBotPrivateMessage, CanonicalMessageId } from '../../types/virtual_message.ts';

interface BotLookup {
  getById(botId: number): VirtualBot | undefined;
}

interface KnownBotPeerLookup {
  knowsPeer(botId: number, peerBotId: number): boolean;
}

interface BotToBotMessageLookup {
  findChatMessage(
    chat: BotToBotPrivateChatKey,
    messageId: CanonicalMessageId,
  ): BotToBotPrivateMessage | undefined;
}

interface MessageBoxLookup {
  getCanonicalMessageId(ownerId: number, messageId: number): CanonicalMessageId | undefined;
}

interface BotToBotPrivateChatPolicyDependencies {
  readonly bots: BotLookup;
  readonly knownBotPeers: KnownBotPeerLookup;
  readonly messages: BotToBotMessageLookup;
  readonly messageBoxes: MessageBoxLookup;
}

/**
 * How a bot reaches its private chat with another bot and the chat's messages: identity, the
 * Bot-to-Bot Communication Mode both bots need, and message lookup, read from the session's
 * state. `botToBotPrivateChatMessagePolicy` states how the chats number their messages and who
 * learns of them.
 */
export class BotToBotPrivateChatPolicy {
  readonly #bots: BotLookup;
  readonly #knownBotPeers: KnownBotPeerLookup;
  readonly #messages: BotToBotMessageLookup;
  readonly #messageBoxes: MessageBoxLookup;

  constructor(
    { bots, knownBotPeers, messages, messageBoxes }: BotToBotPrivateChatPolicyDependencies,
  ) {
    this.#bots = bots;
    this.#knownBotPeers = knownBotPeers;
    this.#messages = messages;
    this.#messageBoxes = messageBoxes;
  }

  /**
   * A bot's private chat with another bot is its chat with a bot it knows, as
   * `KnownBotPeerRepository` describes knowing. As observed on Telegram, a bot that addresses a
   * bot it does not know by ID finds no chat, while one whose username it resolved, or that wrote
   * to it, it reaches by ID too. The conversation itself need not exist yet.
   *
   * @throws {Error} when the bot addresses itself, which has no private chat with itself.
   */
  identifyChatForBot(
    botId: number,
    { peerId }: PrivateChatAddress,
  ): ChatIdentification<{ readonly key: BotToBotPrivateChatKey }, 'peer_bot_unknown'> {
    const conversation = getBotToBotConversationKey(botId, peerId);
    return this.#bots.getById(peerId) === undefined || !this.#knownBotPeers.knowsPeer(botId, peerId)
      ? { identified: false, reason: 'peer_bot_unknown' }
      : { identified: true, key: { type: 'bot_to_bot_private', conversation } };
  }

  /**
   * Whether both bots of the chat turned on Bot-to-Bot Communication Mode, as Telegram requires
   * of both the sender and the recipient of a private message.
   */
  isCommunicationEnabled({ conversation }: BotToBotPrivateChatKey): boolean {
    return [conversation.lowerBotId, conversation.higherBotId].every((botId) =>
      this.#bots.getById(botId)?.enablesBotToBotCommunication === true
    );
  }

  /**
   * Finds a message of the chat by the ID the observing bot's message box gives it. Each bot's box
   * numbers all its private chats, so an ID of another chat's message finds nothing.
   */
  findMessageByObserverMessageId(
    chat: BotToBotPrivateChatKey,
    observerBotId: number,
    observerMessageId: number,
  ): BotToBotPrivateMessage | undefined {
    const canonicalMessageId = this.#messageBoxes.getCanonicalMessageId(
      observerBotId,
      observerMessageId,
    );
    return canonicalMessageId === undefined
      ? undefined
      : this.#messages.findChatMessage(chat, canonicalMessageId);
  }
}
