import {
  type BotApiBotUser,
  type BotApiCallbackQuery,
  type BotApiChatMember,
  type BotApiChatMemberUpdated,
  type BotApiChosenInlineResult,
  type BotApiExternalReplyInfo,
  type BotApiExternalReplyMedia,
  type BotApiGroupChat,
  type BotApiGroupChatBotMember,
  type BotApiInaccessibleMessage,
  type BotApiInlineQuery,
  type BotApiMembershipServiceContent,
  type BotApiMessage,
  type BotApiMessageContent,
  type BotApiMessageEntity,
  type BotApiMessageOrigin,
  type BotApiMyChatMemberUpdated,
  type BotApiPinnedPrivateMessage,
  type BotApiPinnedSupergroupMessage,
  type BotApiPrivateChat,
  type BotApiPrivateChatBotMember,
  type BotApiPrivateMessage,
  type BotApiPrivateMessageContent,
  type BotApiRepliedPrivateMessage,
  type BotApiRepliedPrivateMessageContent,
  type BotApiRepliedSupergroupMessage,
  type BotApiRepliedSupergroupMessageContent,
  type BotApiSupergroupAdministratorRights,
  type BotApiSupergroupChat,
  type BotApiSupergroupMessage,
  type BotApiSupergroupMessageContent,
  type BotApiTextQuote,
  type BotApiUser,
  toBotApiContact,
  toBotApiLocation,
} from '../types/bot_api.ts';
import type { BotApiPoll, BotApiPollAnswer } from '../types/bot_api_poll.ts';
import type { CallbackQuery } from '../types/callback_query.ts';
import type {
  BotBlockChangedEvent,
  ChatMemberStatusChangedEvent,
  InlineQueryResultChosenEvent,
  PollAnswerChangedEvent,
} from '../types/chat_domain_event.ts';
import type {
  ChatMemberStatus,
  SupergroupAdministrator,
  SupergroupAdministratorRights,
} from '../types/chat_membership.ts';
import { getInlineQueryChatType, type InlineQuery } from '../types/inline_query.ts';
import { countPollVoters, type Poll, type PollType } from '../types/poll.ts';
import type { StoredFileId } from '../types/stored_file.ts';
import type { VirtualAccountProfile } from '../types/virtual_account.ts';
import type { VirtualBotProfile } from '../types/virtual_bot.ts';
import type { BasicGroup, Supergroup } from '../types/virtual_chat.ts';
import {
  type ChatMessage,
  type ExternalReply,
  type FormattedText,
  hasProtectedContent,
  type MembershipServiceContent,
  type MessageContent,
  type MessageForwardInfo,
  type MessagePinnedContent,
  type PrivateContentMessage,
  type PrivateMessage,
  type PrivateMessageContent,
  type SupergroupContentMessage,
  type SupergroupMessage,
  type SupergroupMessageContent,
  type TextEntity,
  type TextQuote,
} from '../types/virtual_message.ts';
import { projectChatPermissions } from './bot_api_chat_permissions.ts';
import { writeDateTimeFormat } from './bot_api_date_time_format.ts';
import {
  type ObservedFile,
  projectDocument,
  projectPhotoSize,
  projectVideo,
  projectVoice,
} from './bot_api_file.ts';
import { projectInlineKeyboardMarkup } from './bot_api_inline_keyboard.ts';
import { projectRichMessage } from './bot_api_rich_message.ts';

/** What a projection shows beyond the message itself, resolved for the observer. */
interface MessageProjectionContext {
  /** The user the projection is for. */
  readonly observerId: number;
  /** Every user the message's text, caption, or rich message mentions, by ID. */
  readonly mentionedUsers: ReadonlyMap<number, BotApiUser>;
  /** The file of a captioned media message; omitted for other messages. */
  readonly contentFile?: ObservedFile;
  /**
   * The files of a rich message's photo and document blocks, by stored file; omitted for other
   * messages.
   */
  readonly richMessageFiles?: ReadonlyMap<StoredFileId, ObservedFile>;
  /** The poll a poll message shows, as it is now; omitted for other messages. */
  readonly poll?: ObservedPoll;
  /**
   * The members that joined or left, in the order a service message names them; omitted for
   * other messages.
   */
  readonly changedMembers?: readonly BotApiUser[];
  /**
   * The bot through whose inline mode the message, or the original of a forward, was sent;
   * omitted for other messages.
   */
  readonly viaBot?: BotApiBotUser;
  /**
   * The sender of a forward's original message; omitted for a message that is no forward, or
   * whose origin shows only the name of a hidden user.
   */
  readonly forwardSender?: BotApiUser;
  /**
   * What the message of another chat that the message replies to shows, resolved for the
   * observer; omitted for a message that replies to none.
   */
  readonly externalReply?: ExternalReplyProjectionContext;
}

/** What a reply to a message of another chat shows of it, resolved for the observer. */
export interface ExternalReplyProjectionContext {
  /** Who first wrote the replied message; omitted when its origin shows only a hidden user's name. */
  readonly originSender?: BotApiUser;
  /** The replied message's supergroup; omitted for a message of a private chat. */
  readonly supergroup?: Supergroup;
  /**
   * The file of the replied media; omitted for a replied text, rich message, poll, contact, or
   * location.
   */
  readonly mediaFile?: ObservedFile;
  /** The replied poll, as it is now; omitted for other replied messages. */
  readonly poll?: ObservedPoll;
}

/** A poll as an observer sees it. */
export interface ObservedPoll {
  readonly poll: Poll;
  /** Whether the observer sees a quiz's correct options and explanation. */
  readonly showsQuizSolution: boolean;
  /** Every user a quiz's explanation mentions, by ID; empty for a poll without one. */
  readonly explanationMentionedUsers: ReadonlyMap<number, BotApiUser>;
}

/** A private message as the bot of its conversation observes it, with what a projection needs. */
export interface ObservedPrivateMessage<Message extends PrivateMessage> {
  readonly message: Message;
  /** The conversation's account, which is the observing bot's private-chat peer. */
  readonly account: VirtualAccountProfile;
  /** The conversation's bot, which observes the message. */
  readonly bot: VirtualBotProfile;
  /** The message's ID in the observing bot's message box. */
  readonly observerMessageId: number;
  readonly context: MessageProjectionContext;
}

export interface PrivateMessageForBotProjectionInput
  extends ObservedPrivateMessage<PrivateMessage> {
  /** The replied message as the observing bot sees it; omitted when there is none to show. */
  readonly repliedMessage?: BotApiRepliedPrivateMessage;
  /**
   * The message a pin's service message pinned, as the observing bot sees it, or, once deleted,
   * inaccessible; required for a pin, omitted for other messages.
   */
  readonly pinnedMessage?:
    | BotApiPinnedPrivateMessage
    | BotApiInaccessibleMessage<BotApiPrivateChat>;
}

export interface RepliedPrivateMessageForBotProjectionInput
  extends ObservedPrivateMessage<PrivateMessage> {
  /**
   * The message a pin's service message pinned, as the observing bot sees it; omitted for other
   * messages, and for a deleted one, which the official server leaves out of a replied message.
   */
  readonly pinnedMessage?: BotApiPinnedPrivateMessage;
}

/**
 * Projects a canonical private message as seen by the bot of its conversation, in the field
 * order Telegram uses.
 *
 * The chat is always the account, whoever wrote the message; the sender follows the author.
 */
export function projectPrivateMessageForBot(
  { repliedMessage, pinnedMessage, ...observed }: PrivateMessageForBotProjectionInput,
): BotApiPrivateMessage {
  const { message, context } = observed;
  const content: BotApiPrivateMessageContent = message.content.kind === 'message_pinned'
    ? { pinned_message: requirePinnedMessage(pinnedMessage, message) }
    : projectMessageContent(message.content, context);
  return {
    ...projectPrivateMessageHeader(observed),
    ...projectMessageBody(message, content, context, repliedMessage, false),
  };
}

/**
 * Projects a private message as the message another one replies to shows it, without its own
 * reply, as `projectPrivateMessageForBot` projects a message otherwise.
 */
export function projectRepliedPrivateMessageForBot(
  { pinnedMessage, ...observed }: RepliedPrivateMessageForBotProjectionInput,
): BotApiRepliedPrivateMessage {
  const { message, context } = observed;
  return {
    ...projectPrivateMessageHeader(observed),
    ...projectMessageBody(
      message,
      projectRepliedPrivateMessageContent(message.content, context, pinnedMessage),
      context,
      undefined,
      false,
    ),
  };
}

/**
 * Projects a pinned private message as a pin's service message and `getChat` show it: as a reply
 * shows a message, with content, since service messages are never pinned.
 */
export function projectPinnedPrivateMessageForBot(
  observed: ObservedPrivateMessage<PrivateContentMessage>,
): BotApiPinnedPrivateMessage {
  const { message, context } = observed;
  return {
    ...projectPrivateMessageHeader(observed),
    ...projectMessageBody(
      message,
      projectMessageContent(message.content, context),
      context,
      undefined,
      false,
    ),
  };
}

/** The fields before a private message's body: the chat is the account, whoever wrote it. */
function projectPrivateMessageHeader(
  { message, account, bot, observerMessageId }: ObservedPrivateMessage<PrivateMessage>,
) {
  return {
    message_id: observerMessageId,
    from: message.authorRole === 'account' ? account : projectBotAsUser(bot),
    chat: projectPrivateChat(account),
    date: message.sentAtUnixSeconds,
  };
}

/** A supergroup message as a member observes it, with what a projection needs. */
export interface ObservedSupergroupMessage<Message extends SupergroupMessage> {
  readonly message: Message;
  readonly supergroup: Supergroup;
  /** The member who wrote the message. */
  readonly author: BotApiUser;
  /** The message's ID in the supergroup's message box, which every member sees. */
  readonly messageId: number;
  readonly context: MessageProjectionContext;
}

export interface SupergroupMessageProjectionInput
  extends ObservedSupergroupMessage<SupergroupMessage> {
  /** The replied message; omitted when there is none to show. */
  readonly repliedMessage?: BotApiRepliedSupergroupMessage;
  /**
   * The message a pin's service message pinned, or, once deleted, inaccessible; required for a
   * pin, omitted for other messages.
   */
  readonly pinnedMessage?:
    | BotApiPinnedSupergroupMessage
    | BotApiInaccessibleMessage<BotApiSupergroupChat>;
}

export interface RepliedSupergroupMessageProjectionInput
  extends ObservedSupergroupMessage<SupergroupMessage> {
  /**
   * The message a pin's service message pinned; omitted for other messages, and for a deleted
   * one, which the official server leaves out of a replied message.
   */
  readonly pinnedMessage?: BotApiPinnedSupergroupMessage;
}

/**
 * Projects a canonical supergroup message, in the field order Telegram uses. A supergroup numbers
 * its messages once, so members see the same projection, apart from the `file_id` of its file and
 * the legacy `new_chat_member` field of a service message.
 */
export function projectSupergroupMessage(
  { repliedMessage, pinnedMessage, ...observed }: SupergroupMessageProjectionInput,
): BotApiSupergroupMessage {
  const { message, context, supergroup } = observed;
  const content: BotApiSupergroupMessageContent = message.content.kind === 'message_pinned'
    ? { pinned_message: requirePinnedMessage(pinnedMessage, message) }
    : projectSupergroupMessageContent(message.content, context);
  return {
    ...projectSupergroupMessageHeader(observed),
    ...projectMessageBody(
      message,
      content,
      context,
      repliedMessage,
      supergroup.hasProtectedContent,
    ),
  };
}

/**
 * Projects a supergroup message as the message another one replies to shows it, without its own
 * reply, as `projectSupergroupMessage` projects a message otherwise.
 */
export function projectRepliedSupergroupMessage(
  { pinnedMessage, ...observed }: RepliedSupergroupMessageProjectionInput,
): BotApiRepliedSupergroupMessage {
  const { message, context, supergroup } = observed;
  const content: BotApiRepliedSupergroupMessageContent = message.content.kind === 'message_pinned'
    ? (pinnedMessage === undefined ? {} : { pinned_message: pinnedMessage })
    : projectSupergroupMessageContent(message.content, context);
  return {
    ...projectSupergroupMessageHeader(observed),
    ...projectMessageBody(
      message,
      content,
      context,
      undefined,
      supergroup.hasProtectedContent,
    ),
  };
}

/**
 * Projects a pinned supergroup message as a pin's service message and `getChat` show it, as
 * `projectPinnedPrivateMessageForBot` does for a private one.
 */
export function projectPinnedSupergroupMessage(
  observed: ObservedSupergroupMessage<SupergroupContentMessage>,
): BotApiPinnedSupergroupMessage {
  const { message, context, supergroup } = observed;
  return {
    ...projectSupergroupMessageHeader(observed),
    ...projectMessageBody(
      message,
      projectMessageContent(message.content, context),
      context,
      undefined,
      supergroup.hasProtectedContent,
    ),
  };
}

function projectSupergroupMessageHeader(
  { message, supergroup, author, messageId }: ObservedSupergroupMessage<SupergroupMessage>,
) {
  return {
    message_id: messageId,
    from: author,
    chat: projectSupergroupChat(supergroup),
    date: message.sentAtUnixSeconds,
  };
}

/** The pinned message a pin's service message shows, which its caller must have resolved. */
function requirePinnedMessage<PinnedMessage>(
  pinnedMessage: PinnedMessage | undefined,
  message: ChatMessage,
): PinnedMessage {
  if (pinnedMessage === undefined) {
    throw new Error(`Expected the pinned message of service message ${message.id} to be resolved`);
  }
  return pinnedMessage;
}

/**
 * Projects the fields that follow a message's date, which every chat type shows alike, with the
 * given projection of its content. As the official Bot API server shows a message that cannot be
 * saved, content is protected when its sender or its chat protects it.
 */
function projectMessageBody<
  Content extends
    | BotApiPrivateMessageContent
    | BotApiRepliedPrivateMessageContent
    | BotApiSupergroupMessageContent
    | BotApiRepliedSupergroupMessageContent,
  RepliedMessage,
>(
  message: ChatMessage,
  content: Content,
  context: MessageProjectionContext,
  repliedMessage: RepliedMessage | undefined,
  chatProtectsContent: boolean,
) {
  const { viaBot, forwardSender, externalReply } = context;
  return {
    ...(message.contentEditedAtUnixSeconds === undefined
      ? {}
      : { edit_date: message.contentEditedAtUnixSeconds }),
    ...projectForward(message, forwardSender),
    ...(repliedMessage === undefined ? {} : { reply_to_message: repliedMessage }),
    ...(message.externalReply === undefined
      ? {}
      : { external_reply: projectExternalReply(message.externalReply, externalReply, message) }),
    ...(message.quote === undefined ? {} : { quote: projectTextQuote(message.quote, context) }),
    ...(message.mediaGroupId === undefined ? {} : { media_group_id: message.mediaGroupId }),
    ...content,
    ...(message.inlineKeyboard === undefined
      ? {}
      : { reply_markup: projectInlineKeyboardMarkup(message.inlineKeyboard) }),
    ...(viaBot === undefined ? {} : { via_bot: viaBot }),
    ...(hasProtectedContent(message, chatProtectsContent)
      ? { has_protected_content: true as const }
      : {}),
    ...(message.kind === 'private_message' && message.messageEffectId !== undefined
      ? { effect_id: message.messageEffectId }
      : {}),
  };
}

/** Shows where a forward first appeared, followed by Telegram's legacy fields for it. */
function projectForward(message: ChatMessage, forwardSender: BotApiUser | undefined) {
  if (message.forwardInfo === undefined) {
    return {};
  }
  const forwardOrigin = projectMessageOrigin(message.forwardInfo, forwardSender, message);
  return {
    forward_origin: forwardOrigin,
    ...(forwardOrigin.type === 'user'
      ? { forward_from: forwardOrigin.sender_user }
      : { forward_sender_name: forwardOrigin.sender_user_name }),
    forward_date: forwardOrigin.date,
  };
}

/**
 * Shows where a forward, or a message of another chat that a message replies to, first appeared,
 * as the official Bot API server's `JsonMessageOrigin` does: its sender, or only the name of a
 * hidden user, and when.
 */
function projectMessageOrigin(
  { originalSender, originalSentAtUnixSeconds }: MessageForwardInfo,
  sender: BotApiUser | undefined,
  message: ChatMessage,
): BotApiMessageOrigin {
  if (originalSender.kind === 'hidden_user') {
    return {
      type: 'hidden_user',
      sender_user_name: originalSender.name,
      date: originalSentAtUnixSeconds,
    };
  }
  if (sender === undefined) {
    throw new Error(`Expected the original sender of ${message.id} to be provided`);
  }
  return { type: 'user', sender_user: sender, date: originalSentAtUnixSeconds };
}

/**
 * Shows a message of another chat that a message replies to, as the official Bot API server's
 * `JsonExternalReplyInfo` does: its origin, its supergroup message, and its media.
 */
function projectExternalReply(
  { origin, supergroupMessage, media }: ExternalReply,
  context: ExternalReplyProjectionContext | undefined,
  message: ChatMessage,
): BotApiExternalReplyInfo {
  if (context === undefined) {
    throw new Error('Expected the external reply of the message to be resolved');
  }
  const supergroup = context.supergroup;
  if (supergroupMessage !== undefined && supergroup?.id !== supergroupMessage.chatId) {
    throw new Error(`Expected supergroup ${supergroupMessage.chatId} of the reply to be provided`);
  }
  return {
    origin: projectMessageOrigin(origin, context.originSender, message),
    ...(supergroupMessage === undefined || supergroup === undefined ? {} : {
      chat: projectSupergroupChat(supergroup),
      message_id: supergroupMessage.messageId,
    }),
    ...projectExternalReplyMedia(media, context),
  };
}

function projectExternalReplyMedia(
  media: ExternalReply['media'],
  { mediaFile, poll }: ExternalReplyProjectionContext,
): BotApiExternalReplyMedia {
  switch (media?.kind) {
    case undefined:
      return {};
    case 'poll':
      return { poll: projectPoll(requireObservedPoll(poll, media.pollId)) };
    case 'photo':
      return {
        photo: [projectPhotoSize(mediaFile)],
        ...(media.hasSpoiler ? { has_media_spoiler: true as const } : {}),
      };
    case 'document':
      return { document: projectDocument(mediaFile) };
    case 'video':
      return {
        video: projectVideo(mediaFile, media.startTimestampSeconds),
        ...(media.hasSpoiler ? { has_media_spoiler: true as const } : {}),
      };
    case 'voice':
      return { voice: projectVoice(mediaFile) };
    case 'contact':
      return { contact: toBotApiContact(media.contact) };
    case 'location':
      return { location: toBotApiLocation(media.location) };
    default: {
      const unhandledMedia: never = media;
      throw new Error(`Unhandled external reply media: ${JSON.stringify(unhandledMedia)}`);
    }
  }
}

/** Shows the quoted part of a replied message as the official Bot API server's `JsonTextQuote`. */
function projectTextQuote(
  { text, position, isManual }: TextQuote,
  { mentionedUsers }: MessageProjectionContext,
): BotApiTextQuote {
  return {
    text: text.text,
    ...(text.entities.length === 0 ? {} : {
      entities: text.entities.map((entity) => projectTextEntity(entity, mentionedUsers)),
    }),
    position,
    ...(isManual ? { is_manual: true as const } : {}),
  };
}

/**
 * Projects what a replied private message shows: its content, or, for a pin, the pinned message
 * unless it was deleted, as the official Bot API server's `JsonMessage` leaves it out of a replied
 * message.
 */
function projectRepliedPrivateMessageContent(
  content: PrivateMessageContent,
  context: MessageProjectionContext,
  pinnedMessage: BotApiPinnedPrivateMessage | undefined,
): BotApiRepliedPrivateMessageContent {
  if (content.kind !== 'message_pinned') {
    return projectMessageContent(content, context);
  }
  return pinnedMessage === undefined ? {} : { pinned_message: pinnedMessage };
}

/** Projects what a supergroup message shows other than a pin: content, or a change of it. */
function projectSupergroupMessageContent(
  content: Exclude<SupergroupMessageContent, MessagePinnedContent>,
  context: MessageProjectionContext,
): BotApiMessageContent | BotApiMembershipServiceContent | { readonly new_chat_title: string } {
  switch (content.kind) {
    case 'members_joined':
    case 'member_left':
      return projectMembershipServiceContent(content, context);
    case 'title_changed':
      return { new_chat_title: content.title };
    default:
      return projectMessageContent(content, context);
  }
}

/** Projects a membership change with the members the context resolved for it. */
function projectMembershipServiceContent(
  content: MembershipServiceContent,
  { observerId, changedMembers }: MessageProjectionContext,
): BotApiMembershipServiceContent {
  const [firstMember] = changedMembers ?? [];
  if (firstMember === undefined) {
    throw new Error('Expected the members of the service message to be provided');
  }
  if (content.kind === 'member_left') {
    return { left_chat_participant: firstMember, left_chat_member: firstMember };
  }
  const newChatMember = changedMembers?.find((member) => member.id === observerId) ?? firstMember;
  return {
    new_chat_participant: newChatMember,
    new_chat_member: newChatMember,
    new_chat_members: changedMembers ?? [],
  };
}

function projectMessageContent(
  content: MessageContent,
  { mentionedUsers, contentFile, richMessageFiles, poll }: MessageProjectionContext,
): BotApiMessageContent {
  switch (content.kind) {
    case 'text':
      return {
        text: content.text,
        ...(content.entities.length === 0 ? {} : {
          entities: content.entities.map((entity) => projectTextEntity(entity, mentionedUsers)),
        }),
      };
    case 'photo': {
      const hasCaption = content.caption.text.length > 0;
      return {
        photo: [projectPhotoSize(contentFile)],
        ...projectCaption(content.caption, mentionedUsers),
        ...(hasCaption && content.showsCaptionAboveMedia
          ? { show_caption_above_media: true as const }
          : {}),
        ...(content.hasSpoiler ? { has_media_spoiler: true as const } : {}),
      };
    }
    case 'document':
      return {
        document: projectDocument(contentFile),
        ...projectCaption(content.caption, mentionedUsers),
      };
    case 'video': {
      const hasCaption = content.caption.text.length > 0;
      return {
        video: projectVideo(contentFile, content.startTimestampSeconds),
        ...projectCaption(content.caption, mentionedUsers),
        ...(hasCaption && content.showsCaptionAboveMedia
          ? { show_caption_above_media: true as const }
          : {}),
        ...(content.hasSpoiler ? { has_media_spoiler: true as const } : {}),
      };
    }
    case 'voice':
      return {
        voice: projectVoice(contentFile),
        ...projectCaption(content.caption, mentionedUsers),
      };
    case 'rich_message':
      return {
        rich_message: projectRichMessage(content, {
          mentionedUsers,
          files: richMessageFiles ?? new Map(),
        }),
      };
    case 'poll':
      return { poll: projectPoll(requireObservedPoll(poll, content.pollId)) };
    case 'contact':
      return { contact: toBotApiContact(content.contact) };
    case 'location':
      return { location: toBotApiLocation(content.location) };
    default: {
      const unhandledContent: never = content;
      throw new Error(`Unhandled message content: ${JSON.stringify(unhandledContent)}`);
    }
  }
}

/**
 * Shows a poll as the official Bot API server's `JsonPoll` does for bots, which see every
 * option's voter count. The question's and options' entities are only custom emoji, which name
 * no user. An open poll that closes by itself shows its `open_period` and `close_date`, which TDLib
 * clears once it closes; a quiz shows its correct options and explanation only to an observer that
 * sees them, as TDLib's `get_poll_object` gives them.
 */
export function projectPoll(
  { poll, showsQuizSolution, explanationMentionedUsers }: ObservedPoll,
): BotApiPoll {
  const { optionVoterCounts, totalVoterCount } = countPollVoters(poll);
  const noMentionedUsers = new Map<number, BotApiUser>();
  return {
    id: poll.id,
    question: poll.question.text,
    ...(poll.question.entities.length === 0 ? {} : {
      question_entities: poll.question.entities.map((entity) =>
        projectTextEntity(entity, noMentionedUsers)
      ),
    }),
    options: poll.options.map(({ persistentId, text }, optionPosition) => ({
      persistent_id: persistentId,
      text: text.text,
      ...(text.entities.length === 0 ? {} : {
        text_entities: text.entities.map((entity) => projectTextEntity(entity, noMentionedUsers)),
      }),
      voter_count: optionVoterCounts[optionPosition],
    })),
    total_voter_count: totalVoterCount,
    ...(poll.closingTime === undefined || poll.isClosed ? {} : {
      open_period: poll.closingTime.openPeriodSeconds,
      close_date: poll.closingTime.closeDateUnixSeconds,
    }),
    is_closed: poll.isClosed,
    is_anonymous: poll.isAnonymous,
    allows_multiple_answers: poll.allowsMultipleAnswers,
    allows_revoting: poll.allowsRevoting,
    members_only: false,
    ...projectPollType(poll.type, showsQuizSolution, explanationMentionedUsers),
  };
}

/**
 * Shows a poll's type and, for an observer that sees it, a quiz's solution: `correct_option_id`
 * only for a single correct option, and the explanation with its entities, even none, only when
 * it has text, as the official server's `JsonPoll` writes them.
 */
function projectPollType(
  type: PollType,
  showsQuizSolution: boolean,
  mentionedUsers: ReadonlyMap<number, BotApiUser>,
): Pick<
  BotApiPoll,
  'type' | 'correct_option_id' | 'correct_option_ids' | 'explanation' | 'explanation_entities'
> {
  if (type.kind === 'regular') {
    return { type: 'regular' };
  }
  if (!showsQuizSolution) {
    return { type: 'quiz' };
  }
  const { correctOptionPositions, explanation } = type;
  const [onlyCorrectOptionPosition] = correctOptionPositions;
  return {
    type: 'quiz',
    ...(correctOptionPositions.length === 1
      ? { correct_option_id: onlyCorrectOptionPosition }
      : {}),
    correct_option_ids: correctOptionPositions,
    ...(explanation.text.length === 0 ? {} : {
      explanation: explanation.text,
      explanation_entities: explanation.entities.map((entity) =>
        projectTextEntity(entity, mentionedUsers)
      ),
    }),
  };
}

/**
 * Shows an account's changed answer to a poll as the official Bot API server's `JsonPollAnswer`
 * does: the options it chose, by position and by persistent identifier, which are empty for a
 * retraction.
 */
export function projectPollAnswerForBot(
  { poll, chosenOptionPositions }: PollAnswerChangedEvent,
  voter: VirtualAccountProfile,
): BotApiPollAnswer {
  return {
    poll_id: poll.id,
    user: voter,
    option_ids: chosenOptionPositions,
    option_persistent_ids: chosenOptionPositions.map((optionPosition) =>
      poll.options[optionPosition].persistentId
    ),
  };
}

/** Returns the poll a message shows, which its view must have resolved. */
function requireObservedPoll(observedPoll: ObservedPoll | undefined, pollId: string): ObservedPoll {
  if (observedPoll?.poll.id !== pollId) {
    throw new Error(`Expected poll ${pollId} of the message to be provided`);
  }
  return observedPoll;
}

/** Telegram omits the caption fields of a media message without a caption. */
function projectCaption(caption: FormattedText, mentionedUsers: ReadonlyMap<number, BotApiUser>) {
  if (caption.text.length === 0) {
    return {};
  }
  return {
    caption: caption.text,
    ...(caption.entities.length === 0 ? {} : {
      caption_entities: caption.entities.map((entity) => projectTextEntity(entity, mentionedUsers)),
    }),
  };
}

export interface CallbackQueryForBotProjectionInput {
  readonly callbackQuery: CallbackQuery;
  /** The account that pressed the button. */
  readonly account: VirtualAccountProfile;
  /**
   * The message carrying the pressed button, as the observing bot currently sees it; omitted for
   * an inline message, which the bot knows only by its identifier.
   */
  readonly message?: BotApiMessage;
}

/** Projects a callback query as the bot that owns the pressed button receives it. */
export function projectCallbackQueryForBot(
  { callbackQuery, account, message }: CallbackQueryForBotProjectionInput,
): BotApiCallbackQuery {
  const { id, inlineMessageId, chatInstance, callbackData } = callbackQuery;
  if (inlineMessageId !== undefined) {
    return {
      id,
      from: account,
      inline_message_id: inlineMessageId,
      chat_instance: chatInstance,
      data: callbackData,
    };
  }
  if (message === undefined) {
    throw new Error(`Expected the message of callback query ${id} to be provided`);
  }
  return { id, from: account, message, chat_instance: chatInstance, data: callbackData };
}

/** Projects an inline query as the inline bot receives it. */
export function projectInlineQueryForBot(
  inlineQuery: InlineQuery,
  account: VirtualAccountProfile,
): BotApiInlineQuery {
  return {
    id: inlineQuery.id,
    from: account,
    ...(inlineQuery.userLocation === undefined
      ? {}
      : { location: toBotApiLocation(inlineQuery.userLocation) }),
    chat_type: getInlineQueryChatType(inlineQuery),
    query: inlineQuery.query,
    offset: inlineQuery.offset,
  };
}

/**
 * Projects an account's choice of an inline query result as the inline bot receives it, with the
 * location the account shared with the query. As on Telegram, the bot learns the sent message's
 * identifier only when the message has an inline keyboard.
 */
export function projectChosenInlineResultForBot(
  { inlineQuery, resultId, message }: InlineQueryResultChosenEvent,
  account: VirtualAccountProfile,
): BotApiChosenInlineResult {
  return {
    from: account,
    ...(inlineQuery.userLocation === undefined
      ? {}
      : { location: toBotApiLocation(inlineQuery.userLocation) }),
    ...(message.inlineKeyboard === undefined || message.viaBot === undefined
      ? {}
      : { inline_message_id: message.viaBot.inlineMessageId }),
    query: inlineQuery.query,
    result_id: resultId,
  };
}

export interface BotBlockChangeForBotProjectionInput {
  readonly event: BotBlockChangedEvent;
  /** The account that blocked or unblocked the bot. */
  readonly account: VirtualAccountProfile;
  /** The bot whose membership in the private chat changed, which observes the change. */
  readonly bot: VirtualBotProfile;
}

/**
 * Projects a block or unblock as the blocked bot receives it: as TDLib reports Telegram's
 * `updateBotStopped`, the bot's membership in the account's private chat changes between
 * `member` and `kicked` forever, and the account made the change.
 */
export function projectBotBlockChangeForBot(
  { event, account, bot }: BotBlockChangeForBotProjectionInput,
): BotApiMyChatMemberUpdated {
  const user = projectBotAsUser(bot);
  const member: BotApiPrivateChatBotMember = { user, status: 'member' };
  const kicked: BotApiPrivateChatBotMember = { user, status: 'kicked', until_date: 0 };
  return {
    chat: projectPrivateChat(account),
    from: account,
    date: event.changedAtUnixSeconds,
    old_chat_member: event.isBlocked ? member : kicked,
    new_chat_member: event.isBlocked ? kicked : member,
  };
}

/**
 * Whether the bot that observes a standing may edit an administrator, which the Bot API shows as
 * `can_be_edited`.
 */
export type AdministratorEditability = (administrator: SupergroupAdministrator) => boolean;

export interface BotMembershipChangeProjectionInput {
  readonly event: ChatMemberStatusChangedEvent;
  readonly chat: BasicGroup | Supergroup;
  /** The user that made the change: the bot itself when it left. */
  readonly actor: BotApiUser;
  /** The bot whose membership changed, which observes the change. */
  readonly bot: VirtualBotProfile;
  /** Whether the bot may edit itself as an administrator, before or after the change. */
  readonly canObserverEdit: AdministratorEditability;
}

/** Projects a change of a bot's standing in a group as the bot receives it. */
export function projectBotMembershipChangeForBot(
  { event, chat, actor, bot, canObserverEdit }: BotMembershipChangeProjectionInput,
): BotApiMyChatMemberUpdated {
  const user = projectBotAsUser(bot);
  return {
    chat: projectGroupChat(chat),
    from: actor,
    date: event.changedAtUnixSeconds,
    old_chat_member: projectGroupChatBotMember(user, event.oldStatus, canObserverEdit),
    new_chat_member: projectGroupChatBotMember(user, event.newStatus, canObserverEdit),
  };
}

export interface ChatMemberChangeProjectionInput {
  readonly event: ChatMemberStatusChangedEvent;
  readonly chat: BasicGroup | Supergroup;
  /** The user that made the change: the member itself when it left. */
  readonly actor: BotApiUser;
  /** The account or bot whose standing changed. */
  readonly member: BotApiUser;
  /** Whether the observing bot may edit the member as an administrator, before or after it. */
  readonly canObserverEdit: AdministratorEditability;
}

/** Projects a change of a user's standing in a group as an administrator bot observes it. */
export function projectChatMemberChange(
  { event, chat, actor, member, canObserverEdit }: ChatMemberChangeProjectionInput,
): BotApiChatMemberUpdated {
  return {
    chat: projectGroupChat(chat),
    from: actor,
    date: event.changedAtUnixSeconds,
    old_chat_member: projectChatMember(member, event.oldStatus, canObserverEdit),
    new_chat_member: projectChatMember(member, event.newStatus, canObserverEdit),
  };
}

function projectGroupChatBotMember(
  user: BotApiBotUser,
  status: ChatMemberStatus,
  canObserverEdit: AdministratorEditability,
): BotApiGroupChatBotMember {
  const member = projectChatMember(user, status, canObserverEdit);
  if (member.status === 'creator') {
    throw new Error(`Bot ${user.id} cannot own a group`);
  }
  return member;
}

/**
 * Projects a user's standing in a group as the Bot API shows it to an observing bot, in the field
 * order of the official Bot API server's `JsonChatMember`.
 */
export function projectChatMember<User extends BotApiUser>(
  user: User,
  status: ChatMemberStatus,
  canObserverEdit: AdministratorEditability,
): BotApiChatMember<User> {
  switch (status.status) {
    case 'owner':
      return {
        user,
        status: 'creator',
        ...projectCustomTitle(status.customTitle),
        is_anonymous: false,
      };
    case 'administrator':
      return {
        user,
        status: 'administrator',
        can_be_edited: canObserverEdit({ userId: user.id, membership: status }),
        ...projectSupergroupAdministratorRights(status.rights),
        can_manage_voice_chats: status.rights.has('can_manage_video_chats'),
        ...projectCustomTitle(status.customTitle),
      };
    case 'member':
    case 'left':
      return { user, status: status.status };
    case 'kicked':
      return { user, status: 'kicked', until_date: status.bannedUntilUnixSeconds ?? 0 };
    case 'restricted':
      return {
        user,
        status: 'restricted',
        until_date: status.restrictedUntilUnixSeconds ?? 0,
        ...projectChatPermissions(status.permissions),
        is_member: status.isMember,
      };
    default: {
      const unhandledStatus: never = status;
      throw new Error(`Unhandled chat member status: ${JSON.stringify(unhandledStatus)}`);
    }
  }
}

function projectCustomTitle(
  customTitle: string | undefined,
): { readonly custom_title?: string } {
  return customTitle === undefined ? {} : { custom_title: customTitle };
}

/** Shows every supergroup right, held or not, in the order the Bot API shows them. */
function projectSupergroupAdministratorRights(
  rights: SupergroupAdministratorRights,
): BotApiSupergroupAdministratorRights {
  return {
    can_manage_chat: rights.has('can_manage_chat'),
    can_change_info: rights.has('can_change_info'),
    can_delete_messages: rights.has('can_delete_messages'),
    can_invite_users: rights.has('can_invite_users'),
    can_restrict_members: rights.has('can_restrict_members'),
    can_pin_messages: rights.has('can_pin_messages'),
    can_manage_topics: rights.has('can_manage_topics'),
    can_promote_members: rights.has('can_promote_members'),
    can_manage_video_chats: rights.has('can_manage_video_chats'),
    can_post_stories: rights.has('can_post_stories'),
    can_edit_stories: rights.has('can_edit_stories'),
    can_delete_stories: rights.has('can_delete_stories'),
    can_manage_tags: rights.has('can_manage_tags'),
    can_send_welcome_messages: rights.has('can_send_welcome_messages'),
    is_anonymous: false,
  };
}

/** Shows a bot as messages show users, without the capabilities that only `getMe` reports. */
export function projectBotAsUser(bot: VirtualBotProfile): BotApiBotUser {
  const { id, first_name, last_name, username } = bot;
  return {
    id,
    is_bot: true,
    first_name,
    ...(last_name === undefined ? {} : { last_name }),
    username,
  };
}

/** Shows the private chat with an account, as the bot at its other end sees it. */
export function projectPrivateChat(
  { id, first_name, last_name, username }: VirtualAccountProfile,
): BotApiPrivateChat {
  return {
    id,
    type: 'private',
    first_name,
    ...(last_name === undefined ? {} : { last_name }),
    ...(username === undefined ? {} : { username }),
  };
}

/** Shows a group chat as its members see it. */
function projectGroupChat(chat: BasicGroup | Supergroup): BotApiGroupChat {
  return chat.kind === 'supergroup'
    ? projectSupergroupChat(chat)
    : { id: chat.id, title: chat.title, type: 'group' };
}

/** Shows a supergroup as the official Bot API server's `JsonChat` does, with its username. */
export function projectSupergroupChat({ id, title, username }: Supergroup): BotApiSupergroupChat {
  return { id, title, ...(username === undefined ? {} : { username }), type: 'supergroup' };
}

function projectTextEntity(
  entity: TextEntity,
  mentionedUsers: ReadonlyMap<number, BotApiUser>,
): BotApiMessageEntity {
  const { offset, length } = entity;
  switch (entity.type) {
    case 'pre':
      return entity.language === undefined
        ? { type: 'pre', offset, length }
        : { type: 'pre', offset, length, language: entity.language };
    case 'text_link':
      return { type: 'text_link', offset, length, url: entity.url };
    case 'text_mention': {
      const user = mentionedUsers.get(entity.userId);
      if (user === undefined) {
        throw new Error(`Mentioned user ${entity.userId} was not provided`);
      }
      return { type: 'text_mention', offset, length, user };
    }
    case 'custom_emoji':
      return { type: 'custom_emoji', offset, length, custom_emoji_id: entity.customEmojiId };
    case 'date_time':
      return {
        type: 'date_time',
        offset,
        length,
        unix_time: entity.unixTime,
        date_time_format: writeDateTimeFormat(entity.format),
      };
    default:
      return { type: entity.type, offset, length };
  }
}
