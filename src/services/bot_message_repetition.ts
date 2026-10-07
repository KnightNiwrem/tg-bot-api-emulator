import type { FormerSupergroupMemberFailureReason } from '../types/chat_membership.ts';
import type { InlineKeyboard } from '../types/inline_keyboard.ts';
import { groupRepeatedAlbums } from '../types/media_album.ts';
import {
  createMessageForward,
  getRepeatedContent,
  isForwardable,
  type PrivateForwardNameLookup,
  withVideoStartTimestamp,
} from '../types/message_forward.ts';
import { type Poll, type PollId, showsQuizSolution } from '../types/poll.ts';
import { isUserId } from '../types/telegram_identity.ts';
import {
  type CanonicalMessageId,
  type ChatMessage,
  isCaptionedMediaContent,
  isContentMessage,
  type MediaGroupId,
  type MessageContent,
  type MessageForwardInfo,
} from '../types/virtual_message.ts';
import type {
  CopyMessageRequest,
  CopyMessageSendResult,
  CopyMessagesRequest,
  ForwardMessageRequest,
  ForwardMessageResult,
  MessageTarget,
  RepeatMessagesRequest,
  RepeatMessagesResult,
  SendRequestOptions,
  SendResult,
} from './bot_api.ts';
import type { BotChatMessageLookup, RepetitionDetails } from './bot_message_sending.ts';
import type { CaptionReplacement, OutgoingMessageContent } from './message_content.ts';

interface BotMessageSending {
  send(
    botId: number,
    content: OutgoingMessageContent,
    options: SendRequestOptions,
    repetitionDetails?: RepetitionDetails,
  ): SendResult;
  findBotChatMessage(botId: number, target: MessageTarget): BotChatMessageLookup;
  lacksSendPermission(botId: number, chatId: number, content: OutgoingMessageContent): boolean;
}

interface MediaGroupIdIssuer {
  createMediaGroupId(): MediaGroupId;
}

interface PollLookup {
  getPoll(pollId: PollId): Poll | undefined;
}

interface BotMessageRepeaterDependencies {
  /**
   * Finds the messages that forwards and copies repeat, and sends the repetitions as the bot's
   * other messages are sent.
   */
  readonly messageSender: BotMessageSending;
  /** Issues the identifiers of the albums that forwards and copies of albums form. */
  readonly mediaGroups: MediaGroupIdIssuer;
  /** Finds the polls that copies of poll messages repeat. */
  readonly polls: PollLookup;
  /** Hides the accounts whose privacy settings keep forwards from linking to them. */
  readonly getPrivateForwardName: PrivateForwardNameLookup;
  /** The time that the open periods of copied polls count from. */
  readonly currentUnixTimeSeconds: () => number;
}

/**
 * Why the message that a forward or copy repeats cannot be read: its chat is unknown to the bot,
 * or the bot is no member of it, or the chat has no such message.
 */
type RepeatedMessageFailureReason =
  | 'chat_not_found'
  | FormerSupergroupMemberFailureReason
  | 'repeated_message_not_found';

/** A message that a forward or copy repeats, with whether its chat protects all content. */
type RepeatedMessageLookup =
  | Extract<BotChatMessageLookup, { readonly found: true }>
  | { readonly found: false; readonly reason: RepeatedMessageFailureReason };

/** What a forward or copy repeats of the original. */
interface MessageRepetition {
  /** The original's content, or, for a copy of a poll, a new poll like the original's. */
  readonly content: OutgoingMessageContent;
  /** Omitted for a copy, which does not show where it came from. */
  readonly forwardInfo?: MessageForwardInfo;
  /** Omitted when the repetition shows no inline keyboard. */
  readonly inlineKeyboard?: InlineKeyboard;
}

/**
 * What a copy does with the caption of copied media: keeps it, replaces it with a new caption, or
 * removes it. Text and rich messages stay as they are, and a copy of a poll ignores a new caption.
 */
type CopiedCaption =
  | { readonly kind: 'kept' }
  | { readonly kind: 'replaced'; readonly replacement: CaptionReplacement }
  | { readonly kind: 'removed' };

/**
 * Repeats messages of a bot's chats as forwards and copies, as TDLib's `forward_messages` does for
 * both: it finds the repeated messages, decides which of them the bot may forward or copy, builds
 * each forward and each copy, and sends them through the bot's message sender. `forwardMessage`
 * and `forwardMessages` build forwards alike, and `copyMessage` and `copyMessages` copies.
 */
export class BotMessageRepeater {
  readonly #messageSender: BotMessageSending;
  readonly #mediaGroups: MediaGroupIdIssuer;
  readonly #polls: PollLookup;
  readonly #getPrivateForwardName: PrivateForwardNameLookup;
  readonly #currentUnixTimeSeconds: () => number;

  constructor(
    {
      messageSender,
      mediaGroups,
      polls,
      getPrivateForwardName,
      currentUnixTimeSeconds,
    }: BotMessageRepeaterDependencies,
  ) {
    this.#messageSender = messageSender;
    this.#mediaGroups = mediaGroups;
    this.#polls = polls;
    this.#getPrivateForwardName = getPrivateForwardName;
    this.#currentUnixTimeSeconds = currentUnixTimeSeconds;
  }

  /**
   * Forwards a message of one of the bot's chats to a private chat or a supergroup, as TDLib does:
   * the forward repeats the message's content and shows who first sent it and when, as
   * `#createForward` creates it. A request's video start timestamp replaces that of a forwarded
   * video. As TDLib's `forward_messages_impl` skips content the bot may not send to a supergroup,
   * such content cannot be forwarded there.
   *
   * The forwarded message is checked in full before the chat it goes to, while TDLib checks whether
   * it can be forwarded only after that chat; a request that fails both ways fails for the message.
   */
  forwardMessage(
    botId: number,
    {
      chatId,
      forwardedMessage,
      videoStartTimestampSeconds,
      isContentProtected,
      isSilent,
      messageEffectId,
    }: ForwardMessageRequest,
  ): ForwardMessageResult {
    const lookup = this.#findRepeatedMessage(botId, forwardedMessage);
    if (!lookup.found) {
      return { sent: false, reason: lookup.reason };
    }
    const forward = this.#createForward(
      lookup.message,
      lookup.chatProtectsContent,
      videoStartTimestampSeconds,
    );
    if (forward === undefined) {
      return { sent: false, reason: 'message_not_forwardable' };
    }
    const { content, forwardInfo, inlineKeyboard } = forward;
    const result = this.#messageSender.send(
      botId,
      content,
      {
        chatId,
        isContentProtected,
        isSilent,
        messageEffectId,
        ...(inlineKeyboard === undefined ? {} : { inlineKeyboard }),
      },
      { forwardInfo },
    );
    // TDLib's `forward_messages_impl` skips content the bot may not send, which leaves nothing.
    return !result.sent && result.reason === 'send_permission_missing'
      ? { sent: false, reason: 'message_not_forwardable' }
      : result;
  }

  /**
   * Copies a message of one of the bot's chats to a private chat or a supergroup as the bot's own
   * message, as `#createCopy` creates it, which, unlike a forward, does not show where it came
   * from, and which takes the reply and reply markup of the request instead of the original's. A
   * new caption replaces the caption of copied media, and a video takes the request's start
   * timestamp, if any, as for a forward. A message that `#createCopy` cannot copy, and content the
   * bot may not send to a supergroup, cannot be copied.
   *
   * As for `forwardMessage`, the copied message is checked in full before the chat it goes to.
   */
  copyMessage(
    botId: number,
    {
      copiedMessage,
      videoStartTimestampSeconds,
      caption,
      showsCaptionAboveMedia,
      ...options
    }: CopyMessageRequest,
  ): CopyMessageSendResult {
    const lookup = this.#findRepeatedMessage(botId, copiedMessage);
    if (!lookup.found) {
      return { sent: false, reason: lookup.reason };
    }
    const copiedContent = this.#createCopy(botId, lookup.message, {
      caption: caption === undefined ? { kind: 'kept' } : {
        kind: 'replaced',
        replacement: {
          caption: caption.text,
          captionEntities: caption.entities,
          showsCaptionAboveMedia,
        },
      },
      videoStartTimestampSeconds,
    });
    if (copiedContent === undefined) {
      return { sent: false, reason: 'message_not_copyable' };
    }
    const result = this.#messageSender.send(botId, copiedContent, options);
    // As for `forwardMessage`, TDLib skips content the bot may not send.
    return !result.sent && result.reason === 'send_permission_missing'
      ? { sent: false, reason: 'message_not_copyable' }
      : result;
  }

  /**
   * Forwards up to 100 messages of one of the bot's chats to a private chat or a supergroup, each
   * as `forwardMessage` does, as TDLib's `forward_messages` does. A message that is not found, that
   * cannot be forwarded, or whose content the bot may not send to the chat, is skipped; the request
   * fails only when none is left.
   */
  forwardMessages(botId: number, request: RepeatMessagesRequest): RepeatMessagesResult {
    return this.#repeatMessages(
      botId,
      request,
      (message, chatProtectsContent) => this.#createForward(message, chatProtectsContent),
    );
  }

  /**
   * Copies up to 100 messages of one of the bot's chats to a private chat or a supergroup, as
   * `forwardMessages` forwards them. As TDLib's `dup_reply_markup` does for copies, the copies keep
   * no reply markup; `removesCaptions` sends media without their captions. As for `copyMessage`, a
   * copy of a poll is a new poll.
   */
  copyMessages(
    botId: number,
    { removesCaptions, ...request }: CopyMessagesRequest,
  ): RepeatMessagesResult {
    const caption: CopiedCaption = removesCaptions ? { kind: 'removed' } : { kind: 'kept' };
    return this.#repeatMessages(botId, request, (message) => {
      const content = this.#createCopy(botId, message, { caption });
      return content === undefined ? undefined : { content };
    });
  }

  /**
   * Sends the repetitions of messages of one of the bot's chats to a chat, in the order of their
   * IDs, as TDLib's `forward_messages_impl` does: a message that `repeat` cannot repeat is skipped,
   * and a message that replies to an earlier message of the request replies to that message's
   * repetition.
   *
   * As for `forwardMessage`, the messages are checked before the chat they go to; every repetition
   * goes to that chat, so a chat the bot cannot send to fails before any message is sent.
   */
  #repeatMessages(
    botId: number,
    { chatId, fromChatId, messageIds, isContentProtected, isSilent, messageEffectId }:
      RepeatMessagesRequest,
    repeat: (message: ChatMessage, chatProtectsContent: boolean) => MessageRepetition | undefined,
  ): RepeatMessagesResult {
    const repeatedMessages: Array<{
      readonly messageId: number;
      readonly message: ChatMessage;
      readonly chatProtectsContent: boolean;
    }> = [];
    for (const messageId of messageIds) {
      const lookup = this.#findRepeatedMessage(botId, { chatId: fromChatId, messageId });
      if (lookup.found) {
        const { message, chatProtectsContent } = lookup;
        repeatedMessages.push({ messageId, message, chatProtectsContent });
      } else if (lookup.reason !== 'repeated_message_not_found') {
        return { sent: false, reason: lookup.reason };
      }
    }
    if (repeatedMessages.length === 0) {
      return { sent: false, reason: 'repeated_messages_not_found' };
    }
    if (messageEffectId !== undefined) {
      if (!isUserId(chatId)) {
        return { sent: false, reason: 'message_effect_not_allowed_in_chat' };
      }
      if (repeatedMessages.length > 1) {
        return { sent: false, reason: 'message_effect_not_allowed_for_several_messages' };
      }
    }
    if (
      repeatedMessages.some(({ messageId }, index) =>
        index > 0 && messageId <= repeatedMessages[index - 1].messageId
      )
    ) {
      return { sent: false, reason: 'repeated_message_ids_not_increasing' };
    }
    const repetitions = repeatedMessages.flatMap(({ message, chatProtectsContent }) => {
      const repetition = repeat(message, chatProtectsContent);
      return repetition === undefined ||
          this.#messageSender.lacksSendPermission(botId, chatId, repetition.content)
        ? []
        : [{ message, repetition }];
    });
    if (repetitions.length === 0) {
      return { sent: false, reason: 'messages_not_repeatable' };
    }

    const { albumCount, albumIndexes } = groupRepeatedAlbums(
      repetitions.map(({ message }) => message),
    );
    const newMediaGroupIds = Array.from(
      { length: albumCount },
      () => this.#mediaGroups.createMediaGroupId(),
    );
    const sentMessageIdsByRepeatedMessageId = new Map<CanonicalMessageId, number>();
    for (const [repetitionIndex, { message, repetition }] of repetitions.entries()) {
      const repliedMessageId = message.replyToMessageId === undefined
        ? undefined
        : sentMessageIdsByRepeatedMessageId.get(message.replyToMessageId);
      const albumIndex = albumIndexes[repetitionIndex];
      const { content, forwardInfo, inlineKeyboard } = repetition;
      const result = this.#messageSender.send(
        botId,
        content,
        {
          chatId,
          isContentProtected,
          isSilent,
          messageEffectId,
          ...(inlineKeyboard === undefined ? {} : { inlineKeyboard }),
          ...(repliedMessageId === undefined
            ? {}
            : { replyTo: { messageId: repliedMessageId, allowSendingWithoutReply: true } }),
        },
        {
          forwardInfo,
          mediaGroupId: albumIndex === undefined ? undefined : newMediaGroupIds[albumIndex],
        },
      );
      if (!result.sent) {
        return result;
      }
      sentMessageIdsByRepeatedMessageId.set(message.id, result.message.message_id);
    }
    return { sent: true, messageIds: [...sentMessageIdsByRepeatedMessageId.values()] };
  }

  /**
   * Creates the forward of a message, which shows who first sent it and when, as
   * `createMessageForward` does. As on Telegram, a message whose sender or chat protected it cannot
   * be forwarded, nor can a service message, as `isForwardable` decides; returns `undefined` for
   * them. A video start timestamp replaces that of a forwarded video, as `withVideoStartTimestamp`
   * does. A forward of a poll shows the same poll, whose votes it shares.
   */
  #createForward(
    message: ChatMessage,
    chatProtectsContent: boolean,
    videoStartTimestampSeconds?: number,
  ): MessageRepetition | undefined {
    if (!isForwardable(message, chatProtectsContent)) {
      return undefined;
    }
    const { content, forwardInfo, inlineKeyboard } = createMessageForward(
      message,
      this.#getPrivateForwardName,
    );
    return {
      content: {
        kind: 'existing',
        content: videoStartTimestampSeconds === undefined
          ? content
          : withVideoStartTimestamp(content, videoStartTimestampSeconds),
      },
      forwardInfo,
      ...(inlineKeyboard === undefined ? {} : { inlineKeyboard }),
    };
  }

  /**
   * Creates the content of a copy of a message, which keeps no reply markup. A copy keeps, replaces
   * or removes the caption of media, as `caption` chooses, while text and rich messages stay as
   * they are, apart from the buttons of a rich message, which change as for a forward. A video
   * start timestamp replaces that of a copied video, as for a forward. A copy of a poll is a new
   * poll, as `#createPollCopy` creates it, which ignores a new caption. As TDLib lets bots do, a bot
   * may copy a message whose sender protected it. Returns `undefined` for a message that cannot be
   * copied: a service message, or a quiz whose solution the bot does not see.
   */
  #createCopy(
    botId: number,
    message: ChatMessage,
    { caption, videoStartTimestampSeconds }: {
      readonly caption: CopiedCaption;
      readonly videoStartTimestampSeconds?: number;
    },
  ): OutgoingMessageContent | undefined {
    if (!isContentMessage(message)) {
      return undefined;
    }
    const repeatedContent = getRepeatedContent(message.content, 'copy');
    if (repeatedContent.kind === 'poll') {
      return this.#createPollCopy(botId, repeatedContent.pollId, message);
    }
    const content = videoStartTimestampSeconds === undefined
      ? repeatedContent
      : withVideoStartTimestamp(repeatedContent, videoStartTimestampSeconds);
    switch (caption.kind) {
      case 'kept':
        return { kind: 'existing', content };
      case 'replaced':
        return { kind: 'existing', content, captionReplacement: caption.replacement };
      case 'removed':
        return { kind: 'existing', content: withoutCaption(content) };
      default: {
        const unhandledCaption: never = caption;
        throw new Error(`Unhandled copied caption: ${JSON.stringify(unhandledCaption)}`);
      }
    }
  }

  /**
   * Creates the content of a copy of a poll, as TDLib's `dup_poll` does: a new poll that the copying
   * bot owns, open and without votes, with the original's question, options, settings, and quiz
   * solution, and the original's open period counted from now. As TDLib's `has_input_media` and
   * the Bot API require, a quiz can be copied only by a bot that sees its solution through the
   * copied message, as `showsQuizSolution` decides; returns `undefined` for any other quiz.
   */
  #createPollCopy(
    botId: number,
    pollId: PollId,
    pollMessage: ChatMessage,
  ): OutgoingMessageContent | undefined {
    const poll = this.#polls.getPoll(pollId);
    if (poll === undefined) {
      throw new Error(`Copied poll ${pollId} does not exist`);
    }
    if (poll.type.kind === 'quiz' && !showsQuizSolution(poll, { observerId: botId, pollMessage })) {
      return undefined;
    }
    const openPeriodSeconds = poll.closingTime?.openPeriodSeconds;
    return {
      kind: 'poll',
      poll: {
        creator: { kind: 'bot', botId },
        question: poll.question,
        options: poll.options.map(({ text }) => text),
        isAnonymous: poll.isAnonymous,
        allowsMultipleAnswers: poll.allowsMultipleAnswers,
        allowsRevoting: poll.allowsRevoting,
        type: poll.type,
        isClosed: false,
        ...(openPeriodSeconds === undefined ? {} : {
          closingTime: {
            openPeriodSeconds,
            closeDateUnixSeconds: this.#currentUnixTimeSeconds() + openPeriodSeconds,
          },
        }),
      },
    };
  }

  /**
   * Finds the message of one of the bot's chats that a forward or copy repeats, as the message
   * sender's `findBotChatMessage` finds it; a missing message is reported as a repeated message
   * that is not found.
   */
  #findRepeatedMessage(botId: number, target: MessageTarget): RepeatedMessageLookup {
    const lookup = this.#messageSender.findBotChatMessage(botId, target);
    if (lookup.found) {
      return lookup;
    }
    return {
      found: false,
      reason: lookup.reason === 'message_not_found' ? 'repeated_message_not_found' : lookup.reason,
    };
  }
}

/**
 * Captioned media without its caption, as a copy that removes captions sends it; text and rich
 * messages are kept.
 */
function withoutCaption(content: MessageContent): MessageContent {
  return isCaptionedMediaContent(content)
    ? { ...content, caption: { text: '', entities: [] } }
    : content;
}
