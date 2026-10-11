import type { BotApiMessage } from '../../../types/bot_api.ts';
import type { BotApiPoll } from '../../../types/bot_api_poll.ts';
import type { InlineKeyboard } from '../../../types/inline_keyboard.ts';
import { getBotApiChatAddress } from '../../../types/virtual_chat.ts';
import type { ChatMessage, InlineMessageId } from '../../../types/virtual_message.ts';
import type { EmulationSession } from '../../../session/emulation_session.ts';
import {
  type AuthenticatedBotFailure,
  excludeMissingBotFailure,
  type FailureWithout,
  missingAuthenticatedBotError,
} from './authenticated_bot_failures.ts';
import type { SpecifiedFormattedText } from './formatted_text_reading.ts';
import type { BotApiFamilyContext } from './method_call.ts';
import { richMessageUploadsFile } from './specified_rich_message.ts';

type MessageEditing = EmulationSession['messageEditing'];
type BotMediaResolver = EmulationSession['botMediaResolver'];

/**
 * What the bot's edits of its messages use: the service that edits messages and stops polls, the
 * resolver of the files new content sends, and the view of a message and a poll as the bot sees
 * them.
 */
export type MessageEditContext = BotApiFamilyContext<
  'messageEditing' | 'botMediaResolver' | 'botMessageViews'
>;

/**
 * New media of a message and its caption, as `editMessageMedia` specifies them: a photo, a
 * document, a video, or an audio file, uploaded with the request, reused by the `file_id` the bot
 * knows it by, or downloaded from a URL.
 */
type MediaReplacementRequest = Parameters<BotMediaResolver['resolveMediaContent']>[1];

/** A rich message as a request specifies it, naming each file it sends. */
type RequestedRichMessage = Parameters<BotMediaResolver['resolveRichMessageFiles']>[1];

/** Why a file that new content sends cannot be used: an upload Telegram refuses, or a `file_id`. */
type FileResolutionFailure = Extract<
  ReturnType<BotMediaResolver['resolveMediaContent']>,
  { readonly resolved: false }
>['failure'];

/**
 * New content of a text or rich message, as an edit sends it: text with its formatting, or a rich
 * message whose files are uploaded, downloaded from URLs, or known to the bot by `file_id`.
 */
export type SendableTextMessageReplacement =
  | ({ readonly kind: 'text' } & SpecifiedFormattedText)
  | {
    readonly kind: 'rich_message';
    readonly richMessage: RequestedRichMessage;
    /** Whether Telegram marks the entities it detects in the text. */
    readonly detectsEntities: boolean;
  };

/** A message of one of the bot's chats, as the Bot API addresses it. */
interface ChatMessageTarget {
  /** The Bot API `chat_id`. */
  readonly chatId: number;
  /** The message's ID in the bot's chat. */
  readonly messageId: number;
}

/** A message sent through the bot's inline mode, as the Bot API addresses it. */
interface InlineMessageTarget {
  /** The Bot API `inline_message_id`. */
  readonly inlineMessageId: InlineMessageId;
}

/** The keyboard an edited message shows; omitting it removes the message's keyboard. */
interface EditedKeyboard {
  readonly inlineKeyboard?: InlineKeyboard;
}

/** A new caption, as `editMessageCaption` specifies it. */
interface CaptionReplacementRequest extends EditedKeyboard {
  /** Empty text removes the caption. */
  readonly caption: SpecifiedFormattedText;
  /** The Bot API `show_caption_above_media`, which only a photo or video honors. */
  readonly showsCaptionAboveMedia: boolean;
}

/** The failures of an edit's outcome, each with its reason. */
type Failure<Result> = Extract<Result, { readonly edited: false; readonly reason: string }>;

/**
 * How an edit of a chat message ended: the Bot API answers with the edited message, as the bot sees
 * its chat.
 */
type ChatMessageEditResult<DomainResult> =
  | { readonly edited: true; readonly message: BotApiMessage }
  | AuthenticatedBotFailure<Failure<DomainResult>>;

export type ChatMessageTextEditResult =
  | ChatMessageEditResult<ReturnType<MessageEditing['editChatMessageText']>>
  | ({ readonly edited: false } & FileResolutionFailure);

export type ChatMessageCaptionEditResult = ChatMessageEditResult<
  ReturnType<MessageEditing['editChatMessageCaption']>
>;

export type ChatMessageMediaEditResult =
  | ChatMessageEditResult<ReturnType<MessageEditing['editChatMessageMedia']>>
  | ({ readonly edited: false } & FileResolutionFailure);

export type ChatMessageKeyboardEditResult = ChatMessageEditResult<
  ReturnType<MessageEditing['editChatMessageKeyboard']>
>;

/** How `stopPoll` ended: the Bot API answers with the stopped poll rather than its message. */
export type PollStopResult =
  | { readonly stopped: true; readonly poll: BotApiPoll }
  | AuthenticatedBotFailure<
    Extract<ReturnType<MessageEditing['stopPoll']>, { readonly stopped: false }>
  >;

/**
 * The reasons an edit of an inline message cannot meet: the authenticated bot exists, and it may
 * edit any message sent through its inline mode, which is neither a forward nor a message with a
 * reply keyboard.
 */
type ImpossibleInlineMessageEditReason = 'bot_not_found' | 'message_not_editable';

/**
 * How an edit of an inline message ended: the Bot API answers with `true` rather than the message.
 * An identifier of no message, of a deleted one, or of another bot's inline message finds none.
 */
type InlineMessageEditResult<DomainResult, ImpossibleReason extends string> =
  | { readonly edited: true }
  | FailureWithout<Failure<DomainResult>, ImpossibleInlineMessageEditReason | ImpossibleReason>
  | { readonly edited: false; readonly reason: 'message_not_found' };

/** New content that uploads a file, which an inline message cannot receive. */
interface InlineMessageUploadRefusal {
  readonly edited: false;
  readonly reason: 'inline_message_upload_unsupported';
}

export type InlineMessageTextEditResult =
  | InlineMessageEditResult<ReturnType<MessageEditing['editInlineMessageText']>, never>
  | InlineMessageUploadRefusal
  | ({ readonly edited: false } & FileResolutionFailure);

export type InlineMessageCaptionEditResult = InlineMessageEditResult<
  ReturnType<MessageEditing['editInlineMessageCaption']>,
  never
>;

/** No album holds a message sent through the bot's inline mode. */
export type InlineMessageMediaEditResult =
  | InlineMessageEditResult<
    ReturnType<MessageEditing['editInlineMessageMedia']>,
    'album_media_kind_changed'
  >
  | InlineMessageUploadRefusal
  | ({ readonly edited: false } & FileResolutionFailure);

export type InlineMessageKeyboardEditResult = InlineMessageEditResult<
  ReturnType<MessageEditing['editInlineMessageKeyboard']>,
  never
>;

/**
 * Replaces the content and inline keyboard of a text or rich message the bot sent with new text
 * and its entities, or with a rich message, which may change the message's kind. As for
 * `sendRichMessage`, the files of a rich message are resolved before the message is found.
 */
export function editChatMessageText(
  context: MessageEditContext,
  { chatId, messageId, content, inlineKeyboard }:
    & ChatMessageTarget
    & EditedKeyboard
    & { readonly content: SendableTextMessageReplacement },
): ChatMessageTextEditResult {
  const replacement = resolveTextMessageReplacement(context, content);
  if (!replacement.resolved) {
    return { edited: false, ...replacement.failure };
  }
  const result = viewChatMessageEdit(
    context,
    context.session.messageEditing.editChatMessageText({
      ...botChatMessageTarget(context, chatId, messageId),
      content: replacement.content,
      inlineKeyboard,
    }),
  );
  if (result.edited) {
    return result;
  }
  switch (result.reason) {
    case 'text_invalid':
    case 'send_permission_missing':
      return result;
    default:
      return { edited: false, reason: excludeMissingBotFailure(context.bot, result.reason) };
  }
}

/**
 * Replaces the caption, its entities, and the inline keyboard of captioned media the bot sent;
 * empty caption text removes the caption.
 */
export function editChatMessageCaption(
  context: MessageEditContext,
  { chatId, messageId, caption, showsCaptionAboveMedia, inlineKeyboard }:
    & ChatMessageTarget
    & CaptionReplacementRequest,
): ChatMessageCaptionEditResult {
  const result = viewChatMessageEdit(
    context,
    context.session.messageEditing.editChatMessageCaption({
      ...botChatMessageTarget(context, chatId, messageId),
      caption: caption.text,
      captionEntities: caption.entities,
      showsCaptionAboveMedia,
      inlineKeyboard,
    }),
  );
  if (result.edited) {
    return result;
  }
  switch (result.reason) {
    case 'text_invalid':
      return result;
    default:
      return { edited: false, reason: excludeMissingBotFailure(context.bot, result.reason) };
  }
}

/**
 * Replaces the content, caption and inline keyboard of a message the bot sent with a new photo,
 * document, video, or audio file, as TDLib's `edit_message_media` does; a photo, document, video,
 * or audio message changes its media, and a text or rich message becomes media. As for
 * `sendPhoto`, the file is resolved before the message is found.
 */
export function editChatMessageMedia(
  context: MessageEditContext,
  { chatId, messageId, media, inlineKeyboard }:
    & ChatMessageTarget
    & EditedKeyboard
    & { readonly media: MediaReplacementRequest },
): ChatMessageMediaEditResult {
  const mediaResolution = context.session.botMediaResolver.resolveMediaContent(
    context.bot.id,
    media,
  );
  if (!mediaResolution.resolved) {
    return { edited: false, ...mediaResolution.failure };
  }
  const result = viewChatMessageEdit(
    context,
    context.session.messageEditing.editChatMessageMedia({
      ...botChatMessageTarget(context, chatId, messageId),
      media: mediaResolution.file,
      inlineKeyboard,
    }),
  );
  if (result.edited) {
    return result;
  }
  switch (result.reason) {
    case 'text_invalid':
    case 'send_permission_missing':
      return result;
    default:
      return { edited: false, reason: excludeMissingBotFailure(context.bot, result.reason) };
  }
}

/** Replaces the inline keyboard of a message the bot sent. */
export function editChatMessageKeyboard(
  context: MessageEditContext,
  { chatId, messageId, inlineKeyboard }: ChatMessageTarget & EditedKeyboard,
): ChatMessageKeyboardEditResult {
  const result = viewChatMessageEdit(
    context,
    context.session.messageEditing.editChatMessageKeyboard({
      ...botChatMessageTarget(context, chatId, messageId),
      inlineKeyboard,
    }),
  );
  return result.edited
    ? result
    : { edited: false, reason: excludeMissingBotFailure(context.bot, result.reason) };
}

/**
 * Stops a poll the bot sent, as the official Bot API server's `process_stop_poll_query` and TDLib's
 * `stop_poll` do, and answers with the closed poll. The message is found as an edit finds it, then
 * the poll as `findStoppablePoll` finds it; stopping a closed poll fails. The message shows the new
 * keyboard, or none; no bot receives an `edited_message` update for it.
 */
export function stopPoll(
  context: MessageEditContext,
  { chatId, messageId, inlineKeyboard }: ChatMessageTarget & EditedKeyboard,
): PollStopResult {
  const result = context.session.messageEditing.stopPoll({
    ...botChatMessageTarget(context, chatId, messageId),
    inlineKeyboard,
  });
  return result.stopped
    ? { stopped: true, poll: context.session.botMessageViews.viewPollForCreator(result.poll) }
    : { stopped: false, reason: excludeMissingBotFailure(context.bot, result.reason) };
}

/**
 * Replaces the content and inline keyboard of a text or rich message sent through the bot, as
 * `editChatMessageText` replaces them. As TDLib's `edit_inline_message_text` requires, a rich
 * message may reuse files by their `file_id` but upload none.
 */
export function editInlineMessageText(
  context: MessageEditContext,
  { inlineMessageId, content, inlineKeyboard }:
    & InlineMessageTarget
    & EditedKeyboard
    & { readonly content: SendableTextMessageReplacement },
): InlineMessageTextEditResult {
  if (!isOwnInlineMessage(context, inlineMessageId)) {
    return { edited: false, reason: 'message_not_found' };
  }
  if (content.kind === 'rich_message' && richMessageUploadsFile(content.richMessage)) {
    return { edited: false, reason: 'inline_message_upload_unsupported' };
  }
  const replacement = resolveTextMessageReplacement(context, content);
  if (!replacement.resolved) {
    return { edited: false, ...replacement.failure };
  }
  const result = context.session.messageEditing.editInlineMessageText({
    fromBotId: context.bot.id,
    inlineMessageId,
    content: replacement.content,
    inlineKeyboard,
  });
  if (result.edited) {
    return { edited: true };
  }
  switch (result.reason) {
    case 'text_invalid':
      return result;
    default:
      return {
        edited: false,
        reason: excludeInlineMessageEditabilityFailure(context, result.reason),
      };
  }
}

/**
 * Replaces the caption, its entities, and the inline keyboard of captioned media sent through the
 * bot; empty caption text removes the caption.
 */
export function editInlineMessageCaption(
  context: MessageEditContext,
  { inlineMessageId, caption, showsCaptionAboveMedia, inlineKeyboard }:
    & InlineMessageTarget
    & CaptionReplacementRequest,
): InlineMessageCaptionEditResult {
  if (!isOwnInlineMessage(context, inlineMessageId)) {
    return { edited: false, reason: 'message_not_found' };
  }
  const result = context.session.messageEditing.editInlineMessageCaption({
    fromBotId: context.bot.id,
    inlineMessageId,
    caption: caption.text,
    captionEntities: caption.entities,
    showsCaptionAboveMedia,
    inlineKeyboard,
  });
  if (result.edited) {
    return { edited: true };
  }
  switch (result.reason) {
    case 'text_invalid':
      return result;
    default:
      return {
        edited: false,
        reason: excludeInlineMessageEditabilityFailure(context, result.reason),
      };
  }
}

/**
 * Replaces the content, caption and inline keyboard of a message sent through the bot with a new
 * photo, document, video, or audio file, as `editChatMessageMedia` replaces them. As TDLib's
 * `edit_inline_message_media` requires, the media may reuse a file by its `file_id` or name one by
 * URL but not upload one. A voice note that an inline query result sent keeps its media, as any
 * voice note does.
 */
export function editInlineMessageMedia(
  context: MessageEditContext,
  { inlineMessageId, media, inlineKeyboard }:
    & InlineMessageTarget
    & EditedKeyboard
    & { readonly media: MediaReplacementRequest },
): InlineMessageMediaEditResult {
  if (!isOwnInlineMessage(context, inlineMessageId)) {
    return { edited: false, reason: 'message_not_found' };
  }
  if (getMediaReplacementFile(media).kind === 'upload') {
    return { edited: false, reason: 'inline_message_upload_unsupported' };
  }
  const mediaResolution = context.session.botMediaResolver.resolveMediaContent(
    context.bot.id,
    media,
  );
  if (!mediaResolution.resolved) {
    return { edited: false, ...mediaResolution.failure };
  }
  const result = context.session.messageEditing.editInlineMessageMedia({
    fromBotId: context.bot.id,
    inlineMessageId,
    media: mediaResolution.file,
    inlineKeyboard,
  });
  if (result.edited) {
    return { edited: true };
  }
  switch (result.reason) {
    case 'text_invalid':
      return result;
    case 'album_media_kind_changed':
      throw new Error(`Inline message ${inlineMessageId} belongs to an album`);
    default:
      return {
        edited: false,
        reason: excludeInlineMessageEditabilityFailure(context, result.reason),
      };
  }
}

/** Replaces the inline keyboard of a message sent through the bot. */
export function editInlineMessageKeyboard(
  context: MessageEditContext,
  { inlineMessageId, inlineKeyboard }: InlineMessageTarget & EditedKeyboard,
): InlineMessageKeyboardEditResult {
  if (!isOwnInlineMessage(context, inlineMessageId)) {
    return { edited: false, reason: 'message_not_found' };
  }
  const result = context.session.messageEditing.editInlineMessageKeyboard({
    fromBotId: context.bot.id,
    inlineMessageId,
    inlineKeyboard,
  });
  return result.edited ? { edited: true } : {
    edited: false,
    reason: excludeInlineMessageEditabilityFailure(context, result.reason),
  };
}

/**
 * Resolves new content of a text or rich message: the files of a rich message, as
 * `resolveRichMessageFiles` resolves them.
 */
function resolveTextMessageReplacement(
  context: MessageEditContext,
  content: SendableTextMessageReplacement,
):
  | {
    readonly resolved: true;
    readonly content: Parameters<MessageEditing['editInlineMessageText']>[0]['content'];
  }
  | { readonly resolved: false; readonly failure: FileResolutionFailure } {
  if (content.kind === 'text') {
    return { resolved: true, content };
  }
  const resolution = context.session.botMediaResolver.resolveRichMessageFiles(
    context.bot.id,
    content.richMessage,
  );
  return resolution.resolved
    ? {
      resolved: true,
      content: {
        kind: 'rich_message',
        richMessage: resolution.richMessage,
        detectsEntities: content.detectsEntities,
      },
    }
    : resolution;
}

/**
 * Whether an inline message identifier names a message sent through the bot's inline mode, which
 * an inline edit checks before it reads the new content. Another bot's inline message is not the
 * bot's own.
 */
function isOwnInlineMessage(
  context: MessageEditContext,
  inlineMessageId: InlineMessageId,
): boolean {
  return context.session.messageEditing.findBotInlineMessage(context.bot.id, inlineMessageId) !==
    undefined;
}

/**
 * The message of one of the bot's chats that a chat message edit addresses, by the chat its
 * `chat_id` names and the ID by which that chat's messages are addressed.
 */
function botChatMessageTarget(context: MessageEditContext, chatId: number, messageId: number) {
  return { fromBotId: context.bot.id, chat: getBotApiChatAddress(chatId), messageId };
}

/** Shows the bot the message its edit of a chat message left, as the bot sees its chat. */
function viewChatMessageEdit<EditFailure extends { readonly edited: false }>(
  context: MessageEditContext,
  result: { readonly edited: true; readonly message: ChatMessage } | EditFailure,
): { readonly edited: true; readonly message: BotApiMessage } | EditFailure {
  return result.edited
    ? {
      edited: true,
      message: context.session.botMessageViews.viewMessageForBot(result.message, context.bot.id),
    }
    : result;
}

/** The file that new media names, as its request specifies it. */
function getMediaReplacementFile(media: MediaReplacementRequest) {
  switch (media.kind) {
    case 'photo':
      return media.photo;
    case 'document':
      return media.document;
    case 'video':
      return media.video;
    case 'audio':
      return media.audio;
    default: {
      const unhandledMedia: never = media;
      throw new Error(`Unhandled media replacement: ${JSON.stringify(unhandledMedia)}`);
    }
  }
}

/**
 * Leaves out the failures of an edit of an inline message that cannot occur, as
 * `ImpossibleInlineMessageEditReason` names them.
 */
function excludeInlineMessageEditabilityFailure<Reason extends string>(
  context: MessageEditContext,
  reason: Reason | 'bot_not_found' | 'message_not_editable',
): Reason {
  switch (reason) {
    case 'bot_not_found':
      throw missingAuthenticatedBotError(context.bot);
    case 'message_not_editable':
      throw new Error(`Bot ${context.bot.id} may not edit its own inline message`);
    default:
      return reason;
  }
}
