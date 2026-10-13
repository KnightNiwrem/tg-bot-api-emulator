import type { FormerSupergroupMemberFailureReason } from '../../../types/chat_membership.ts';
import { createWrittenContact, type WrittenContact } from '../../../types/contact.ts';
import type { GeoLocation } from '../../../types/geo_location.ts';
import { checkAlbumComposition, toAlbumMember } from '../../../types/media_album.ts';
import {
  MAX_POLL_OPEN_PERIOD_SECONDS,
  MIN_POLL_OPEN_PERIOD_SECONDS,
  type PollClosingTime,
} from '../../../types/poll.ts';
import {
  type ChatAction,
  type ChatAddress,
  getBotApiChatAddress,
  getBotChatKey,
} from '../../../types/virtual_chat.ts';
import type { EmulationSession } from '../../../session/emulation_session.ts';
import { missingAuthenticatedBotError } from './authenticated_bot_failures.ts';
import type { SpecifiedFormattedText } from './formatted_text_reading.ts';
import type { BotApiFamilyContext } from './method_call.ts';

type BotMessageSender = EmulationSession['botMessageSending']['sender'];
type BotMediaResolver = EmulationSession['botMediaResolver'];

/**
 * What the sending methods use: the sender of the bot's messages with the session's normalization
 * of bot text and its clock, the resolver of the files they send, the chat actions and drafts they
 * show, and the private chats and supergroups whose access a chat action needs.
 */
export type MessageSendContext = BotApiFamilyContext<
  | 'botMessageSending'
  | 'botMediaResolver'
  | 'chatActions'
  | 'messageDrafts'
  | 'privateMessaging'
  | 'supergroupMessaging'
>;

/** Where and how every send method sends its message, and what it replies to. */
export type SendRequestOptions = Parameters<BotMessageSender['send']>[2];

/** A message a send method sent, as the bot sees it, or why it was not sent. */
export type SendResult = ReturnType<BotMessageSender['send']>;

/** An invoice `sendInvoice` sent, as the bot sees it, or why it was not sent. */
export type SendInvoiceResult = ReturnType<BotMessageSender['sendInvoice']>;

/** Where and how an album is sent, and what every message of it replies to. */
type SendAlbumOptions = Parameters<BotMessageSender['sendAlbum']>[2];

/**
 * The Bot API answers `sendMediaGroup` with the album's messages in order. As the official server's
 * `on_message_send_failed` does, an upload Telegram's servers refuse fails the album with the
 * position of the first message whose upload they refuse, counted from 1.
 */
export type SendMediaGroupResult = ReturnType<BotMessageSender['sendAlbum']>;

/**
 * An upload of an album's message that Telegram's servers refuse once the album is sent: content
 * they cannot process as a photo, or a file larger than a local Bot API server lets bots upload.
 */
type ServerRefusedUploadFailure = Extract<
  SendMediaGroupResult,
  { readonly reason: 'media_group_member_not_sent' }
>['failure'];

/**
 * New media and its caption, as `sendPhoto`, `sendDocument`, `sendVideo` and `sendAudio` send it
 * and an album holds it: a file uploaded with the request, reused by the `file_id` the bot knows it
 * by, or downloaded from a URL.
 */
export type MediaReplacementRequest = Parameters<BotMediaResolver['resolveMediaContent']>[1];

/** A voice note and its caption, as `sendVoice` specifies them. */
type SpecifiedVoice = Parameters<BotMediaResolver['resolveVoiceMedia']>[1];

/** A rich message as a request specifies it, naming each file it sends. */
type RequestedRichMessage = Parameters<BotMediaResolver['resolveRichMessageFiles']>[1];

/** Why a file a request sends cannot be used: an upload Telegram refuses, or a `file_id`. */
type FileResolutionFailure = Extract<
  ReturnType<BotMediaResolver['resolveMediaContent']>,
  { readonly resolved: false }
>['failure'];

/** A poll's type as `sendPoll` specifies it: regular, or a quiz with its solution. */
export type PollTypeRequest =
  | { readonly kind: 'regular' }
  | {
    readonly kind: 'quiz';
    /** The Bot API `correct_option_ids`, or the legacy `correct_option_id` as one position. */
    readonly correctOptionPositions: readonly number[];
    /** The Bot API `explanation`; empty text for none. */
    readonly explanation: SpecifiedFormattedText;
  };

/** When a poll closes by itself, as `sendPoll` specifies it with one of two parameters. */
type PollClosingTimeRequest =
  | { readonly kind: 'open_period'; readonly openPeriodSeconds: number }
  | { readonly kind: 'close_date'; readonly closeDateUnixSeconds: number };

/**
 * A regular poll or a quiz as `sendPoll` specifies it. Restrictions on who may vote, added
 * options, media, descriptions, and shuffled or hidden results are not supported.
 */
type SendPollRequest = SendRequestOptions & {
  readonly question: SpecifiedFormattedText;
  /** The answer options' texts, in the order clients show them. */
  readonly pollOptions: readonly SpecifiedFormattedText[];
  /** The Bot API `is_anonymous`. */
  readonly isAnonymous: boolean;
  /** The Bot API `allows_multiple_answers`. */
  readonly allowsMultipleAnswers: boolean;
  /** The Bot API `allows_revoting`. */
  readonly allowsRevoting: boolean;
  readonly type: PollTypeRequest;
  /** The Bot API `is_closed`, which sends the poll closed, as a preview. */
  readonly isClosed: boolean;
  /** Omitted for a poll that stays open until it is stopped. */
  readonly closingTime?: PollClosingTimeRequest;
};

/** Why a bot cannot show a chat action or a message draft in a chat. */
type BotChatActionAccessFailureReason =
  | 'chat_not_found'
  /** The account of the bot's private chat does not exist, or never started the chat. */
  | 'account_not_found'
  | 'conversation_not_started'
  | FormerSupergroupMemberFailureReason
  | 'bot_blocked';

export type SendChatActionResult =
  | { readonly sent: true }
  | { readonly sent: false; readonly reason: BotChatActionAccessFailureReason };

/** Why the session's normalization refuses a draft's text that is not well-formed. */
type DraftTextInvalidFailure = Extract<
  Extract<
    ReturnType<EmulationSession['botMessageSending']['normalizeBotDraftText']>,
    { readonly normalized: false }
  >['failure'],
  { readonly reason: 'text_invalid' }
>;

export type SendMessageDraftResult =
  | { readonly sent: true }
  | (
    & { readonly sent: false }
    & (
      | DraftTextInvalidFailure
      | {
        readonly reason:
          | BotChatActionAccessFailureReason
          | 'draft_chat_not_private'
          | 'draft_id_missing'
          | 'message_text_too_long';
      }
    )
  );

/**
 * Sends text to a private chat or a supergroup, optionally as a reply to one of the chat's
 * messages and with an inline keyboard. A message can instead change the reply interface the
 * account of a private chat sees, or the one the chosen members of a supergroup see.
 */
export function sendMessage(
  context: MessageSendContext,
  { text, entities, ...options }: SpecifiedFormattedText & SendRequestOptions,
): SendResult {
  return context.session.botMessageSending.sender.send(
    context.bot.id,
    { kind: 'text', text, entities },
    options,
  );
}

/**
 * Sends a rich message, laid out in blocks, as `sendMessage` sends text. The files of its media
 * blocks are uploaded with the request or reused by the `file_id` the bot knows them by, as
 * `sendPhoto`, `sendDocument`, `sendVideo` and `sendVoice` send theirs, and are resolved before the
 * chat, as theirs are.
 */
export function sendRichMessage(
  context: MessageSendContext,
  { richMessage, detectsEntities, ...options }: SendRequestOptions & {
    readonly richMessage: RequestedRichMessage;
    /**
     * Whether Telegram marks the entities it detects in the text; the Bot API's
     * `skip_entity_detection` turns it off.
     */
    readonly detectsEntities: boolean;
  },
): SendResult {
  const resolution = context.session.botMediaResolver.resolveRichMessageFiles(
    context.bot.id,
    richMessage,
  );
  if (!resolution.resolved) {
    return { sent: false, ...resolution.failure };
  }
  return context.session.botMessageSending.sender.send(context.bot.id, {
    kind: 'rich_message',
    richMessage: resolution.richMessage,
    detectsEntities,
  }, options);
}

/**
 * Sends a photo, a document, a video or an audio file with an optional caption, as `sendMessage`
 * sends text. The file is uploaded with the request, reused by the `file_id` the bot knows it by,
 * or downloaded from a URL.
 *
 * The file is resolved before the chat, while Telegram looks at the chat first; a request with
 * both an unknown chat and an unusable file fails for its file. Telegram sends some documents,
 * such as videos and GIF animations, as other media unless the request disables content type
 * detection, may send a video in another format as a document, and its clients play MP3 and M4A
 * audio; the emulator inspects no content, reads no tags, and always sends the media requested.
 */
export function sendMedia(
  context: MessageSendContext,
  { media, options }: {
    readonly media: MediaReplacementRequest;
    readonly options: SendRequestOptions;
  },
): SendResult {
  const resolution = context.session.botMediaResolver.resolveMediaContent(context.bot.id, media);
  if (!resolution.resolved) {
    return { sent: false, ...resolution.failure };
  }
  return context.session.botMessageSending.sender.send(context.bot.id, resolution.file, options);
}

/**
 * Sends a voice note with an optional caption, as `sendMedia` sends other media. Telegram
 * documents that its clients play OGG/Opus, MP3 and M4A voice notes and that it may send other
 * formats as audio or documents; the emulator inspects no content and always sends a voice note,
 * apart from one sent by URL, which the bot media resolver's `resolveVoiceMedia` may send as a
 * document.
 */
export function sendVoice(
  context: MessageSendContext,
  { voice, durationSeconds, caption, ...options }: SendRequestOptions & SpecifiedVoice,
): SendResult {
  const resolution = context.session.botMediaResolver.resolveVoiceMedia(context.bot.id, {
    voice,
    durationSeconds,
    caption,
  });
  if (!resolution.resolved) {
    return { sent: false, ...resolution.failure };
  }
  return context.session.botMessageSending.sender.send(context.bot.id, resolution.file, options);
}

/**
 * Sends photos and videos, documents, or audio files to a private chat or a supergroup as an
 * album, as TDLib's `send_message_group` does: each message's file is resolved as `sendMedia`
 * resolves it, in order, and the album is then checked as `checkAlbumComposition` does. An upload
 * that only Telegram's servers refuse fails after those checks, as TDLib learns of it only when
 * the album is sent. Every check passes before any message is sent; the messages are then sent in
 * order, each as a reply to the same message, and share a new `media_group_id` unless there is
 * just one.
 *
 * As for `sendMedia`, files are resolved before the chat, while Telegram looks at the chat first;
 * a request with both an unknown chat and an unusable file fails for its file.
 */
export function sendMediaGroup(
  context: MessageSendContext,
  { media, ...options }: SendAlbumOptions & { readonly media: readonly MediaReplacementRequest[] },
): SendMediaGroupResult {
  const { botMediaResolver, botMessageSending } = context.session;
  const contents: Parameters<BotMessageSender['sendAlbum']>[1][number][] = [];
  let firstRefusedUpload:
    | { readonly memberPosition: number; readonly failure: ServerRefusedUploadFailure }
    | undefined;
  for (const [memberIndex, member] of media.entries()) {
    const resolution = botMediaResolver.resolveMediaContent(context.bot.id, member);
    if (!resolution.resolved && !isRefusedByTelegramServers(resolution.failure)) {
      return { sent: false, ...resolution.failure };
    }
    // As TDLib's `get_input_message_content` does, each message's caption is checked once its file
    // is read, before the next message; sending checks it again when it stores the album.
    const captionNormalization = botMessageSending.normalizeBotCaption({
      caption: member.caption.text,
      captionEntities: member.caption.entities,
    });
    if (!captionNormalization.normalized) {
      return { sent: false, ...captionNormalization.failure };
    }
    if (resolution.resolved) {
      contents.push(resolution.file);
    } else if (isRefusedByTelegramServers(resolution.failure)) {
      firstRefusedUpload ??= { memberPosition: memberIndex + 1, failure: resolution.failure };
    }
  }
  const compositionFailure = checkAlbumComposition(media.map(toAlbumMember));
  if (compositionFailure !== undefined) {
    return { sent: false, reason: compositionFailure };
  }
  if (firstRefusedUpload !== undefined) {
    return { sent: false, reason: 'media_group_member_not_sent', ...firstRefusedUpload };
  }
  return botMessageSending.sender.sendAlbum(context.bot.id, contents, options);
}

/**
 * Sends a contact to a private chat or a supergroup, as `sendMessage` sends text. Its texts are
 * cleaned as `normalizeOutgoingContent` cleans a contact, where `sendMessage` normalizes text. As
 * the official Bot API server's `process_send_contact_query` names no user, and the emulator never
 * looks users up by phone number, the contact shows no user.
 */
export function sendContact(
  context: MessageSendContext,
  { contact, ...options }: SendRequestOptions & { readonly contact: WrittenContact },
): SendResult {
  return context.session.botMessageSending.sender.send(
    context.bot.id,
    { kind: 'contact', contact: createWrittenContact(contact) },
    options,
  );
}

/**
 * Sends a static location to a private chat or a supergroup, as `sendMessage` sends text. The
 * caller reads the location as `isPointOnEarth` requires, since TDLib refuses other coordinates
 * while reading the request; a location carries no text to normalize.
 */
export function sendLocation(
  context: MessageSendContext,
  { location, ...options }: SendRequestOptions & { readonly location: GeoLocation },
): SendResult {
  return context.session.botMessageSending.sender.send(
    context.bot.id,
    { kind: 'location', location },
    options,
  );
}

/**
 * Sends a regular poll or a quiz to a private chat or a supergroup, as `sendMessage` sends text.
 * Its question, options, and quiz settings are checked as `normalizeNewPoll` checks them, where
 * `sendMessage` checks its text. The bot owns the poll; the accounts of the chat vote in it.
 *
 * A closing time is checked first, as `resolvePollClosingTime` checks it, while Telegram's servers
 * check it only once the poll is sent; a request that also fails otherwise fails for its closing
 * time.
 */
export function sendPoll(
  context: MessageSendContext,
  {
    question,
    pollOptions,
    isAnonymous,
    allowsMultipleAnswers,
    allowsRevoting,
    type,
    isClosed,
    closingTime,
    ...options
  }: SendPollRequest,
): SendResult {
  const closingTimeResolution = closingTime === undefined
    ? undefined
    : resolvePollClosingTime(context, closingTime);
  if (closingTimeResolution?.resolved === false) {
    return { sent: false, reason: closingTimeResolution.reason };
  }
  return context.session.botMessageSending.sender.send(context.bot.id, {
    kind: 'poll',
    poll: {
      creator: { kind: 'bot', botId: context.bot.id },
      question,
      options: pollOptions,
      isAnonymous,
      allowsMultipleAnswers,
      allowsRevoting,
      type,
      isClosed,
      ...(closingTimeResolution === undefined
        ? {}
        : { closingTime: closingTimeResolution.closingTime }),
    },
  }, options);
}

/**
 * Shows a chat action, such as typing, in a private chat or a supergroup, which the chat's accounts
 * see until it expires, is canceled, or the bot sends a message there.
 */
export function sendChatAction(
  context: MessageSendContext,
  { chatId, action }: { readonly chatId: number; readonly action: ChatAction },
): SendChatActionResult {
  const chat = getBotApiChatAddress(chatId);
  const access = checkBotChatActionAccess(context, chat);
  if (!access.allowed) {
    return { sent: false, reason: access.reason };
  }
  context.session.chatActions.recordBotChatAction({
    botId: context.bot.id,
    chat: getBotChatKey(context.bot.id, chat),
    action,
  });
  return { sent: true };
}

/**
 * Shows a draft of a message the bot is generating in its private chat with an account, as
 * `MessageDraft` describes it, until the bot sends a message there or a test expires it.
 *
 * As the official Bot API server and TDLib check a draft, the bot must be able to address the chat
 * before TDLib normalizes the text, which, like a bot's caption, may be empty. Telegram's servers
 * then refuse a chat that is not private, a bot the account blocks, a missing draft ID, and text
 * too long for a message; the emulator checks those in that order, which Telegram does not
 * document.
 */
export function sendMessageDraft(
  context: MessageSendContext,
  { chatId, draftId, text, canStop, keepOnStop }: {
    /** The Bot API `chat_id`. */
    readonly chatId: number;
    /**
     * Telegram's decimal text form of the draft's 64-bit identifier; omitted for none, which a 0
     * also means and Telegram refuses.
     */
    readonly draftId?: string;
    /** The draft's text as the bot specified it, not yet normalized. */
    readonly text: SpecifiedFormattedText;
    /** Whether the account's client shows a Stop button, which asks the bot to stop. */
    readonly canStop: boolean;
    /** Whether the draft stays shown once the account presses Stop. */
    readonly keepOnStop: boolean;
  },
): SendMessageDraftResult {
  const chat = getBotApiChatAddress(chatId);
  const access = checkBotChatActionAccess(context, chat);
  if (!access.allowed && access.reason !== 'bot_blocked') {
    return { sent: false, reason: access.reason };
  }
  const textNormalization = context.session.botMessageSending.normalizeBotDraftText({
    text: text.text,
    entities: text.entities ?? [],
  });
  if (!textNormalization.normalized && textNormalization.failure.reason === 'text_invalid') {
    return { sent: false, ...textNormalization.failure };
  }
  if (chat.type !== 'private') {
    return { sent: false, reason: 'draft_chat_not_private' };
  }
  if (!access.allowed) {
    return { sent: false, reason: access.reason };
  }
  if (draftId === undefined) {
    return { sent: false, reason: 'draft_id_missing' };
  }
  if (!textNormalization.normalized) {
    return { sent: false, ...textNormalization.failure };
  }
  context.session.messageDrafts.showBotDraft(
    { accountId: chat.peerId, botId: context.bot.id },
    { draftId, text: textNormalization.formattedText, canStop, keepOnStop },
  );
  return { sent: true };
}

/**
 * Resolves when a poll sent now closes by itself, as Telegram shows it: an open period of 5 to
 * 2628000 seconds closes the poll that long after now, and a close date at least 5 and at most
 * 2628000 seconds after now leaves the poll open until then. The Bot API documents these limits,
 * which Telegram's servers enforce.
 */
function resolvePollClosingTime(
  context: MessageSendContext,
  closingTime: PollClosingTimeRequest,
):
  | { readonly resolved: true; readonly closingTime: PollClosingTime }
  | {
    readonly resolved: false;
    readonly reason: 'poll_open_period_invalid' | 'poll_close_date_invalid';
  } {
  const now = context.session.botMessageSending.currentUnixTimeSeconds();
  const openPeriodSeconds = closingTime.kind === 'open_period'
    ? closingTime.openPeriodSeconds
    : closingTime.closeDateUnixSeconds - now;
  if (
    !Number.isSafeInteger(openPeriodSeconds) ||
    openPeriodSeconds < MIN_POLL_OPEN_PERIOD_SECONDS ||
    openPeriodSeconds > MAX_POLL_OPEN_PERIOD_SECONDS
  ) {
    return {
      resolved: false,
      reason: closingTime.kind === 'open_period'
        ? 'poll_open_period_invalid'
        : 'poll_close_date_invalid',
    };
  }
  return {
    resolved: true,
    closingTime: { openPeriodSeconds, closeDateUnixSeconds: now + openPeriodSeconds },
  };
}

/**
 * Checks that the bot may show a chat action, or a message draft, which TDLib sends as one, in a
 * private chat or a supergroup.
 */
function checkBotChatActionAccess(
  context: MessageSendContext,
  chat: ChatAddress,
):
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: BotChatActionAccessFailureReason } {
  const fromBotId = context.bot.id;
  const access = chat.type === 'private'
    ? context.session.privateMessaging.checkBotChatActionAccess({ fromBotId, chat })
    : context.session.supergroupMessaging.checkBotChatActionAccess({ fromBotId, chat });
  if (access.allowed) {
    return access;
  }
  if (access.reason === 'bot_not_found') {
    throw missingAuthenticatedBotError(context.bot);
  }
  return { allowed: false, reason: access.reason };
}

/**
 * Whether only Telegram's servers refuse a file, once they receive the message that sends it,
 * rather than TDLib as it reads the file: content they cannot process as a photo, or a file larger
 * than a local Bot API server lets bots upload. `api.telegram.org` refuses an oversized upload with
 * the whole request, and TDLib checks emptiness, the photo size limit, and `file_id` values
 * itself.
 */
function isRefusedByTelegramServers(
  failure: FileResolutionFailure,
): failure is FileResolutionFailure & ServerRefusedUploadFailure {
  switch (failure.reason) {
    case 'image_invalid':
    case 'photo_dimensions_invalid':
      return true;
    case 'bot_upload_too_big':
      return failure.uploadProfile === 'local';
    default:
      return false;
  }
}
