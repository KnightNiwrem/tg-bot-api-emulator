import type {
  BotApiCallbackQuery,
  BotApiChatJoinRequest,
  BotApiChatMemberUpdated,
  BotApiChosenInlineResult,
  BotApiInlineQuery,
  BotApiMessage,
  BotApiMessageGenerationStopped,
  BotApiMessageReactionUpdated,
  BotApiMyChatMemberUpdated,
  BotApiPrivateMessage,
  BotApiSupergroupMessage,
  BotApiUpdateType,
} from '../types/bot_api.ts';
import type { BotApiPoll, BotApiPollAnswer } from '../types/bot_api_poll.ts';
import type { CallbackQuery } from '../types/callback_query.ts';
import type {
  BotBlockChangedEvent,
  CallbackQueryCreatedEvent,
  ChatDomainEvent,
  ChatJoinRequestedEvent,
  ChatMemberStatusChangedEvent,
  InlineQueryCreatedEvent,
  InlineQueryResultChosenEvent,
  MessageGenerationStoppedEvent,
  MessageReactionChangedEvent,
  PollAnswerChangedEvent,
} from '../types/chat_domain_event.ts';
import type { ChatMembership } from '../types/chat_membership.ts';
import type { InlineQuery } from '../types/inline_query.ts';
import type { Poll } from '../types/poll.ts';
import type { VirtualBot, VirtualBotProfile } from '../types/virtual_bot.ts';
import {
  type CanonicalMessageId,
  type ChatMessage,
  getContentText,
  isPrivateContentMessage,
  isSupergroupContentMessage,
  mentionsUser,
  type PrivateMessage,
  type SupergroupContentMessage,
  type SupergroupMessage,
} from '../types/virtual_message.ts';

interface BotMessageViews {
  viewPrivateMessageForBot(message: PrivateMessage): BotApiPrivateMessage;
  viewSupergroupMessage(message: SupergroupMessage, observerId: number): BotApiSupergroupMessage;
  viewCallbackQueryForBot(
    callbackQuery: CallbackQuery,
    message: ChatMessage,
  ): BotApiCallbackQuery;
  viewPollForCreator(poll: Poll): BotApiPoll;
  viewPollAnswerForBot(event: PollAnswerChangedEvent): BotApiPollAnswer;
  viewInlineQueryForBot(inlineQuery: InlineQuery): BotApiInlineQuery;
  viewChosenInlineResultForBot(event: InlineQueryResultChosenEvent): BotApiChosenInlineResult;
  viewBotBlockChangeForBot(event: BotBlockChangedEvent): BotApiMyChatMemberUpdated;
  viewMessageGenerationStopForBot(
    event: MessageGenerationStoppedEvent,
  ): BotApiMessageGenerationStopped;
  viewBotMembershipChangeForBot(event: ChatMemberStatusChangedEvent): BotApiMyChatMemberUpdated;
  viewChatMemberChange(
    event: ChatMemberStatusChangedEvent,
    observerBotId: number,
  ): BotApiChatMemberUpdated;
  viewChatJoinRequestForBot(
    event: ChatJoinRequestedEvent,
    observerBotId: number,
  ): BotApiChatJoinRequest;
  viewMessageReactionChangeForBot(event: MessageReactionChangedEvent): BotApiMessageReactionUpdated;
}

interface BotUpdateMailboxes {
  enqueueMessageUpdate(botId: number, message: BotApiMessage): void;
  enqueueEditedMessageUpdate(botId: number, editedMessage: BotApiMessage): void;
  enqueueCallbackQueryUpdate(botId: number, callbackQuery: BotApiCallbackQuery): void;
  enqueuePollUpdate(botId: number, poll: BotApiPoll): void;
  enqueuePollAnswerUpdate(botId: number, pollAnswer: BotApiPollAnswer): void;
  enqueueInlineQueryUpdate(botId: number, inlineQuery: BotApiInlineQuery): void;
  enqueueChosenInlineResultUpdate(
    botId: number,
    chosenInlineResult: BotApiChosenInlineResult,
  ): void;
  enqueueMyChatMemberUpdate(botId: number, myChatMember: BotApiMyChatMemberUpdated): void;
  enqueueChatMemberUpdate(botId: number, chatMember: BotApiChatMemberUpdated): void;
  enqueueChatJoinRequestUpdate(botId: number, chatJoinRequest: BotApiChatJoinRequest): void;
  enqueueMessageReactionUpdate(
    botId: number,
    messageReaction: BotApiMessageReactionUpdated,
  ): void;
  enqueueStoppedMessageGenerationUpdate(
    botId: number,
    stoppedMessageGeneration: BotApiMessageGenerationStopped,
  ): void;
}

interface BotUpdateSubscriptionLookup {
  getAllowedUpdateTypes(botId: number): ReadonlySet<BotApiUpdateType>;
}

interface BotLookup {
  getById(botId: number): VirtualBot | undefined;
}

interface ChatMemberLookup {
  getChatMemberIds(chatId: number): readonly number[];
  getChatMembership(chatId: number, identityId: number): ChatMembership | undefined;
}

interface SupergroupMessageLookup {
  getSupergroupMessage(messageId: CanonicalMessageId): SupergroupMessage | undefined;
}

interface BotUpdateDeliveryServiceDependencies {
  readonly botMessageViews: BotMessageViews;
  readonly botUpdates: BotUpdateMailboxes;
  readonly updateSubscriptions: BotUpdateSubscriptionLookup;
  readonly bots: BotLookup;
  readonly sharedChats: ChatMemberLookup;
  readonly messages: SupergroupMessageLookup;
}

/** What a bot receives of a message: a new message, or an edit of one. */
type MessageUpdateType = Extract<BotApiUpdateType, 'message' | 'edited_message'>;

/**
 * The one bot in privacy mode that a supergroup message is explicitly meant for, which alone of
 * such bots receives it: a bot known by its ID, or, for a command addressed by username, whichever
 * bot of the supergroup has that username, if any.
 */
type PrivacyModeAddressee =
  | { readonly kind: 'bot'; readonly botId: number }
  | { readonly kind: 'username'; readonly username: string };

/**
 * Turns chat domain events into Bot API updates.
 *
 * It selects the bots that observe each event, projects the event for each of them, and appends
 * the resulting update to that bot's mailbox. A bot that has not subscribed to the update's type
 * never receives it, as Telegram drops such updates when they are created; the underlying chat
 * state is unaffected.
 */
export class BotUpdateDeliveryService {
  readonly #botMessageViews: BotMessageViews;
  readonly #botUpdates: BotUpdateMailboxes;
  readonly #updateSubscriptions: BotUpdateSubscriptionLookup;
  readonly #bots: BotLookup;
  readonly #sharedChats: ChatMemberLookup;
  readonly #messages: SupergroupMessageLookup;
  /**
   * The bot that last sent a content message to each supergroup, which alone of the bots in
   * privacy mode receives commands without a username there.
   */
  readonly #lastMessageSendingBotIds = new Map<number, number>();

  constructor(
    { botMessageViews, botUpdates, updateSubscriptions, bots, sharedChats, messages }:
      BotUpdateDeliveryServiceDependencies,
  ) {
    this.#botMessageViews = botMessageViews;
    this.#botUpdates = botUpdates;
    this.#updateSubscriptions = updateSubscriptions;
    this.#bots = bots;
    this.#sharedChats = sharedChats;
    this.#messages = messages;
  }

  publish(event: ChatDomainEvent): void {
    switch (event.type) {
      case 'message_created':
        this.#deliverMessage(event.message, 'message');
        return;
      case 'message_edited':
        this.#deliverMessage(event.message, 'edited_message');
        return;
      case 'callback_query_created':
        this.#deliverCallbackQuery(event);
        return;
      case 'poll_answer_changed':
        this.#deliverPollAnswerChange(event);
        return;
      case 'poll_closed':
        this.#deliverPollState(event.poll);
        return;
      case 'inline_query_created':
        this.#deliverInlineQuery(event);
        return;
      case 'inline_query_result_chosen':
        this.#deliverChosenInlineResult(event);
        return;
      case 'bot_block_changed':
        this.#deliverBotBlockChange(event);
        return;
      case 'message_generation_stopped':
        this.#deliverMessageGenerationStop(event);
        return;
      case 'chat_member_status_changed':
        this.#deliverChatMemberStatusChange(event);
        return;
      case 'chat_join_requested':
        this.#deliverChatJoinRequest(event);
        return;
      case 'message_reaction_changed':
        this.#deliverMessageReactionChange(event);
        return;
      default: {
        const unhandledEvent: never = event;
        throw new Error(`Unhandled chat domain event: ${JSON.stringify(unhandledEvent)}`);
      }
    }
  }

  #deliverMessage(message: ChatMessage, updateType: MessageUpdateType): void {
    switch (message.kind) {
      case 'private_message':
        this.#deliverPrivateMessage(message, updateType);
        return;
      case 'supergroup_message':
        this.#deliverSupergroupMessage(message, updateType);
        return;
      default: {
        const unhandledMessage: never = message;
        throw new Error(`Unhandled message: ${JSON.stringify(unhandledMessage)}`);
      }
    }
  }

  /**
   * A private message, and each edit of it, is observed only by the bot of its conversation,
   * which, as on Telegram, receives no update for its own message or edit. A service message
   * recording the bot's own pin is the exception, which the Bot API server's
   * `need_skip_update_message` keeps among a bot's outgoing messages.
   */
  #deliverPrivateMessage(message: PrivateMessage, updateType: MessageUpdateType): void {
    const observingBotId = message.conversation.botId;
    const isOwnContentMessage = message.authorRole === 'bot' && isPrivateContentMessage(message);
    if (isOwnContentMessage || !this.#isSubscribed(observingBotId, updateType)) {
      return;
    }

    this.#enqueueMessage(
      observingBotId,
      updateType,
      this.#botMessageViews.viewPrivateMessageForBot(message),
    );
  }

  /**
   * A supergroup message, and each edit of it, is observed by the supergroup's bots that can read
   * it. As on Telegram, a bot never observes its own messages. Nor does it observe other bots'
   * messages, which Telegram delivers only to bots that enable bot-to-bot communication, a setting
   * the emulator does not model. A bot in privacy mode observes only messages addressed to it,
   * unless it is an administrator.
   *
   * Telegram lets a message reach only one bot in privacy mode, the one it is explicitly meant
   * for, if any, as `#findPrivacyModeAddressee` finds it. Only a message meant for no bot in
   * particular reaches bots in privacy mode through a mention or a command without a username, as
   * `#isImplicitlyAddressedToBot` decides. Which bots subscribe to the update does not change who
   * the message is meant for.
   */
  #deliverSupergroupMessage(
    message: SupergroupMessage,
    updateType: MessageUpdateType,
  ): void {
    if (!isSupergroupContentMessage(message)) {
      this.#deliverServiceMessage(message);
      return;
    }
    if (message.author.kind === 'bot') {
      if (updateType === 'message') {
        this.#lastMessageSendingBotIds.set(message.chatId, message.author.botId);
      }
      return;
    }
    const addressee = this.#findPrivacyModeAddressee(message);
    for (const memberId of this.#sharedChats.getChatMemberIds(message.chatId)) {
      const bot = this.#bots.getById(memberId)?.profile;
      if (bot === undefined) {
        continue;
      }
      const readsMessage = this.#readsAllGroupMessages(bot, message.chatId) ||
        (addressee === undefined
          ? this.#isImplicitlyAddressedToBot(message, bot)
          : isPrivacyModeAddressee(addressee, bot));
      if (!readsMessage || !this.#isSubscribed(bot.id, updateType)) {
        continue;
      }
      this.#enqueueMessage(
        bot.id,
        updateType,
        this.#botMessageViews.viewSupergroupMessage(message, bot.id),
      );
    }
  }

  /**
   * A service message about a change of the supergroup's members or title is observed by every
   * bot of the supergroup, privacy mode notwithstanding, and by a bot that left or was removed,
   * which, as on Telegram, still learns of its own departure. Telegram delivers service messages
   * to every bot, so, unlike other messages, a bot's service message, about its leaving, its
   * removal of a member, or its change of the title, reaches the other bots too, and, as the Bot
   * API server's `need_skip_update_message` does for removals and title changes, the bot that
   * made it.
   */
  #deliverServiceMessage(message: SupergroupMessage): void {
    const departedMemberIds = message.content.kind === 'member_left'
      ? [message.content.memberId]
      : [];
    const observerIds = new Set([
      ...this.#sharedChats.getChatMemberIds(message.chatId),
      ...departedMemberIds,
    ]);
    for (const observerId of observerIds) {
      if (
        this.#bots.getById(observerId) === undefined || !this.#isSubscribed(observerId, 'message')
      ) {
        continue;
      }
      this.#botUpdates.enqueueMessageUpdate(
        observerId,
        this.#botMessageViews.viewSupergroupMessage(message, observerId),
      );
    }
  }

  #enqueueMessage(botId: number, updateType: MessageUpdateType, message: BotApiMessage): void {
    if (updateType === 'message') {
      this.#botUpdates.enqueueMessageUpdate(botId, message);
    } else {
      this.#botUpdates.enqueueEditedMessageUpdate(botId, message);
    }
  }

  /** A callback query is observed only by the bot whose message carries the pressed button. */
  #deliverCallbackQuery({ callbackQuery, message }: CallbackQueryCreatedEvent): void {
    const observingBotId = callbackQuery.botId;
    if (!this.#isSubscribed(observingBotId, 'callback_query')) {
      return;
    }

    this.#botUpdates.enqueueCallbackQueryUpdate(
      observingBotId,
      this.#botMessageViews.viewCallbackQueryForBot(callbackQuery, message),
    );
  }

  /**
   * A changed answer to a poll is observed only by the bot that sent the poll, as the Bot API
   * documents, wherever the answer was given: through the poll's message or a forward of it. The
   * bot receives the voter's `poll_answer` only for a poll that is not anonymous, then the poll's
   * new counts. No bot observes answers to an account's poll.
   */
  #deliverPollAnswerChange(event: PollAnswerChangedEvent): void {
    const { poll } = event;
    if (poll.creator.kind !== 'bot') {
      return;
    }
    const { botId } = poll.creator;
    if (!poll.isAnonymous && this.#isSubscribed(botId, 'poll_answer')) {
      this.#botUpdates.enqueuePollAnswerUpdate(
        botId,
        this.#botMessageViews.viewPollAnswerForBot(event),
      );
    }
    this.#deliverPollState(poll);
  }

  /**
   * A poll's new state is observed only by the bot that sent the poll. The Bot API documents that
   * bots also receive updates about polls stopped manually, but which bots Telegram's servers
   * tell is not in the open-source code, so no bot observes the state of an account's poll.
   */
  #deliverPollState(poll: Poll): void {
    if (poll.creator.kind !== 'bot' || !this.#isSubscribed(poll.creator.botId, 'poll')) {
      return;
    }
    this.#botUpdates.enqueuePollUpdate(
      poll.creator.botId,
      this.#botMessageViews.viewPollForCreator(poll),
    );
  }

  /** An inline query is observed only by the inline bot it was sent to. */
  #deliverInlineQuery({ inlineQuery }: InlineQueryCreatedEvent): void {
    if (!this.#isSubscribed(inlineQuery.botId, 'inline_query')) {
      return;
    }
    this.#botUpdates.enqueueInlineQueryUpdate(
      inlineQuery.botId,
      this.#botMessageViews.viewInlineQueryForBot(inlineQuery),
    );
  }

  /**
   * An account's choice of an inline query result is observed only by the inline bot, and, as on
   * Telegram, only when its inline feedback is turned on.
   */
  #deliverChosenInlineResult(event: InlineQueryResultChosenEvent): void {
    const { botId } = event.inlineQuery;
    if (
      this.#bots.getById(botId)?.receivesChosenInlineResults !== true ||
      !this.#isSubscribed(botId, 'chosen_inline_result')
    ) {
      return;
    }
    this.#botUpdates.enqueueChosenInlineResultUpdate(
      botId,
      this.#botMessageViews.viewChosenInlineResultForBot(event),
    );
  }

  /** A block or unblock is observed only by the bot whose membership in the chat changed. */
  #deliverBotBlockChange(event: BotBlockChangedEvent): void {
    if (!this.#isSubscribed(event.botId, 'my_chat_member')) {
      return;
    }

    this.#botUpdates.enqueueMyChatMemberUpdate(
      event.botId,
      this.#botMessageViews.viewBotBlockChangeForBot(event),
    );
  }

  /** A press of a draft's Stop button is observed only by the bot that streamed the draft. */
  #deliverMessageGenerationStop(event: MessageGenerationStoppedEvent): void {
    if (!this.#isSubscribed(event.botId, 'stopped_message_generation')) {
      return;
    }

    this.#botUpdates.enqueueStoppedMessageGenerationUpdate(
      event.botId,
      this.#botMessageViews.viewMessageGenerationStopForBot(event),
    );
  }

  /**
   * A change of a bot's standing in a group is observed by that bot as a `my_chat_member` update.
   * As on Telegram, the group's administrator bots that subscribe to `chat_member` updates
   * observe changes of other members' standing, including changes they made; other bots learn of
   * members joining and leaving only from the service messages that record it.
   */
  #deliverChatMemberStatusChange(event: ChatMemberStatusChangedEvent): void {
    if (
      this.#bots.getById(event.memberId) !== undefined &&
      this.#isSubscribed(event.memberId, 'my_chat_member')
    ) {
      this.#botUpdates.enqueueMyChatMemberUpdate(
        event.memberId,
        this.#botMessageViews.viewBotMembershipChangeForBot(event),
      );
    }

    const observerIds = this.#sharedChats.getChatMemberIds(event.chat.id).filter((memberId) =>
      memberId !== event.memberId && this.#bots.getById(memberId) !== undefined &&
      this.#isAdministrator(memberId, event.chat.id) && this.#isSubscribed(memberId, 'chat_member')
    );
    for (const observerId of observerIds) {
      this.#botUpdates.enqueueChatMemberUpdate(
        observerId,
        this.#botMessageViews.viewChatMemberChange(event, observerId),
      );
    }
  }

  /**
   * A request to join a supergroup is observed by the recipients chat admission chose for it, its
   * administrator bots that hold the `can_invite_users` right, as the Bot API documents for
   * `chat_join_request` updates.
   */
  #deliverChatJoinRequest(event: ChatJoinRequestedEvent): void {
    for (const botId of event.request.recipientBotIds) {
      if (!this.#isSubscribed(botId, 'chat_join_request')) {
        continue;
      }
      this.#botUpdates.enqueueChatJoinRequestUpdate(
        botId,
        this.#botMessageViews.viewChatJoinRequestForBot(event, botId),
      );
    }
  }

  /**
   * An account's change of its reactions to a supergroup message is observed by the supergroup's
   * administrator bots that subscribe to `message_reaction` updates, as the Bot API documents for
   * them; privacy mode does not matter. Bots never change reactions that bots observe.
   */
  #deliverMessageReactionChange(event: MessageReactionChangedEvent): void {
    const { chatId } = event.message;
    const observerIds = this.#sharedChats.getChatMemberIds(chatId).filter((memberId) =>
      this.#bots.getById(memberId) !== undefined && this.#isAdministrator(memberId, chatId) &&
      this.#isSubscribed(memberId, 'message_reaction')
    );
    if (observerIds.length === 0) {
      return;
    }
    const messageReaction = this.#botMessageViews.viewMessageReactionChangeForBot(event);
    for (const observerId of observerIds) {
      this.#botUpdates.enqueueMessageReactionUpdate(observerId, messageReaction);
    }
  }

  /**
   * Finds the bot in privacy mode that an account's supergroup message is explicitly meant for, as
   * Telegram documents it, in order of precedence: the bot that a replied message was meant for,
   * since replies take precedence, the bot the message was sent through, and the bot a leading
   * command names. Returns `undefined` for a message meant for no bot in particular.
   *
   * Telegram documents only that replies take precedence; the emulator ranks the inline bot of a
   * message before the bot its command names.
   */
  #findPrivacyModeAddressee(message: SupergroupContentMessage): PrivacyModeAddressee | undefined {
    const repliedMessage = message.replyToMessageId === undefined
      ? undefined
      : this.#messages.getSupergroupMessage(message.replyToMessageId);
    const repliedMessageAddressee = repliedMessage === undefined
      ? undefined
      : this.#findRepliedMessageAddressee(repliedMessage);
    if (repliedMessageAddressee !== undefined) {
      return repliedMessageAddressee;
    }
    if (message.viaBot !== undefined) {
      return { kind: 'bot', botId: message.viaBot.botId };
    }
    const commandUsername = findLeadingCommandUsername(message);
    return commandUsername === undefined
      ? undefined
      : { kind: 'username', username: commandUsername };
  }

  /**
   * Finds the bot a replied message was meant for, which a reply to it is meant for too: the bot
   * that wrote it, or the bot an account's message was explicitly meant for.
   */
  #findRepliedMessageAddressee(
    repliedMessage: SupergroupMessage,
  ): PrivacyModeAddressee | undefined {
    if (repliedMessage.author.kind === 'bot') {
      return { kind: 'bot', botId: repliedMessage.author.botId };
    }
    return isSupergroupContentMessage(repliedMessage)
      ? this.#findPrivacyModeAddressee(repliedMessage)
      : undefined;
  }

  /**
   * Whether an account's supergroup message that is meant for no bot in particular reaches a bot
   * in privacy mode: through a mention of the bot, or a command without a username at the start of
   * the text or caption, which, as Telegram documents, reaches only the bot that last sent a
   * message to the group. That bot may be one that reads all messages anyway, in which case no bot
   * in privacy mode receives the command.
   *
   * Telegram does not document who receives such a command before any bot has sent a message to
   * the group; the emulator delivers it to every bot in privacy mode then.
   */
  #isImplicitlyAddressedToBot(message: SupergroupMessage, bot: VirtualBotProfile): boolean {
    if (mentionsUser(message.content, bot)) {
      return true;
    }
    if (!startsWithCommandWithoutUsername(message)) {
      return false;
    }
    const lastMessageSendingBotId = this.#lastMessageSendingBotIds.get(message.chatId);
    return lastMessageSendingBotId === undefined || lastMessageSendingBotId === bot.id;
  }

  /**
   * Whether a bot receives every message of a group it is a member of: with privacy mode disabled,
   * or, as Telegram documents, as one of the group's administrators.
   */
  #readsAllGroupMessages(bot: VirtualBotProfile, chatId: number): boolean {
    return bot.can_read_all_group_messages || this.#isAdministrator(bot.id, chatId);
  }

  #isAdministrator(memberId: number, chatId: number): boolean {
    return this.#sharedChats.getChatMembership(chatId, memberId)?.status === 'administrator';
  }

  #isSubscribed(botId: number, updateType: BotApiUpdateType): boolean {
    return this.#updateSubscriptions.getAllowedUpdateTypes(botId).has(updateType);
  }
}

/** Usernames are matched as Telegram matches them, ignoring letter case. */
function isPrivacyModeAddressee(addressee: PrivacyModeAddressee, bot: VirtualBotProfile): boolean {
  return addressee.kind === 'bot'
    ? addressee.botId === bot.id
    : addressee.username.toLowerCase() === bot.username.toLowerCase();
}

/**
 * The text of the bot command at the start of a message's text or caption, such as `/start` or
 * `/start@test_bot`; `undefined` when the text starts with no command.
 */
function findLeadingCommand(message: SupergroupMessage): string | undefined {
  const { text, entities } = getContentText(message.content);
  const leadingCommand = entities.find((entity) =>
    entity.type === 'bot_command' && entity.offset === 0
  );
  return leadingCommand === undefined ? undefined : text.slice(0, leadingCommand.length);
}

/** The username that the command at the start of a message names, as in `/start@test_bot`. */
function findLeadingCommandUsername(message: SupergroupMessage): string | undefined {
  const [, addressedUsername] = findLeadingCommand(message)?.split('@') ?? [];
  return addressedUsername;
}

function startsWithCommandWithoutUsername(message: SupergroupMessage): boolean {
  const leadingCommand = findLeadingCommand(message);
  return leadingCommand !== undefined && !leadingCommand.includes('@');
}
