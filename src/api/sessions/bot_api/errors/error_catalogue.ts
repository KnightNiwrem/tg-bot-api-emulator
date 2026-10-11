import type { PermissionGovernedContent } from '../../../../types/chat_permissions.ts';
import {
  MAX_POLL_OPEN_PERIOD_SECONDS,
  MAX_POLL_OPTION_COUNT,
  MAX_POLL_OPTION_TEXT_LENGTH,
  MAX_POLL_QUESTION_LENGTH,
  MAX_QUIZ_EXPLANATION_LENGTH,
  MAX_QUIZ_EXPLANATION_LINE_FEEDS,
  MIN_POLL_OPEN_PERIOD_SECONDS,
} from '../../../../types/poll.ts';
import { MAX_PHOTO_UPLOAD_BYTES, type StoredFile } from '../../../../types/stored_file.ts';
import type { BotUploadTooBigFailure } from '../../../../types/upload_profile.ts';
import { badRequestDescription, describeAlbumMessageNotSent } from '../method_call.ts';
import {
  type BotApiErrorTemplate,
  botApiServerSource,
  emulatorInference,
  fixedBotApiError,
  observedBehavior,
  tdlibSource,
  telegramApiDocumentation,
} from './error_template.ts';

/** TDLib's names of file types in its errors about a file of the wrong type. */
const TDLIB_FILE_TYPE_NAMES = {
  photo: 'Photo',
  document: 'Document',
  video: 'Video',
  voice: 'VoiceNote',
  audio: 'Audio',
  thumbnail: 'Thumbnail',
} as const satisfies Record<StoredFile['type'], string>;

/**
 * TDLib's `can_send_message_content` errors, as the official Bot API server reports them, for each
 * kind of content a member lacks the permission to send.
 */
const SEND_PERMISSION_MISSING_DESCRIPTIONS = {
  text: 'Bad Request: not enough rights to send text messages to the chat',
  photo: 'Bad Request: not enough rights to send photos to the chat',
  document: 'Bad Request: not enough rights to send documents to the chat',
  video: 'Bad Request: not enough rights to send videos to the chat',
  voice: 'Bad Request: not enough rights to send voice notes to the chat',
  audio: 'Bad Request: not enough rights to send music to the chat',
  poll: 'Bad Request: not enough rights to send polls to the chat',
  rich_message: 'Bad Request: not enough rights to send the rich message to the chat',
  contact: 'Bad Request: not enough rights to send contacts to the chat',
  location: 'Bad Request: not enough rights to send locations to the chat',
} as const satisfies Record<PermissionGovernedContent['kind'], string>;

/**
 * An upload of an album's message that Telegram's servers refuse once the album is sent: content
 * they cannot process as a photo, or a file larger than a local Bot API server lets bots upload.
 */
type AlbumMemberUploadRefusal =
  | { readonly reason: 'image_invalid' | 'photo_dimensions_invalid' }
  | (BotUploadTooBigFailure & { readonly uploadProfile: 'local' });

/** The emulator's wording of the size checks Telegram makes without a description in the source. */
const UPLOAD_LIMIT_INFERENCE =
  "Telegram enforces a local server's upload limit without a description in the source; the " +
  "emulator words it as TDLib's check_full_local_location words its own size checks";

/** The emulator's rationale for descriptions of limits only Telegram's servers check. */
const DOCUMENTED_LIMIT_INFERENCE =
  'Telegram documents the limit and its servers enforce it, but their description is not in the ' +
  'open-source code';

/** The errors of `check_full_local_location`, which TDLib makes before it uploads a file. */
const LOCAL_FILE_CHECKS = tdlibSource('td/telegram/files/FileLoaderUtils.cpp#L273-L340');

/** The official Bot API server's `check_message`, which words a missing message by its role. */
const CHECK_MESSAGE = botApiServerSource('telegram-bot-api/Client.cpp#L9084-L9104');

/** TDLib's `forward_message`, which refuses a forward or copy that its checks skipped. */
const FORWARDED_MESSAGE_SKIPPED = tdlibSource('td/telegram/MessagesManager.cpp#L24490-L24493');

/**
 * The errors with which the Bot API answers a refused call, as templates over each failure's
 * details, with where each description comes from. Presenters map an operation's domain failures
 * to these entries; tests compare the answers with literal descriptions, never with this catalogue.
 */
export const BOT_API_ERRORS = {
  // Chats the bot cannot address.
  chatNotFound: fixedBotApiError(
    400,
    'Bad Request: chat not found',
    botApiServerSource('telegram-bot-api/Client.cpp#L7239-L7242'),
  ),
  botNotSupergroupMember: fixedBotApiError(
    403,
    'Forbidden: bot is not a member of the supergroup chat',
    botApiServerSource('telegram-bot-api/Client.cpp#L8850-L8857'),
  ),
  botKickedFromSupergroup: fixedBotApiError(
    403,
    'Forbidden: bot was kicked from the supergroup chat',
    botApiServerSource('telegram-bot-api/Client.cpp#L8841-L8848'),
  ),
  botBlocked: fixedBotApiError(
    403,
    'Forbidden: bot was blocked by the user',
    botApiServerSource('telegram-bot-api/Client.cpp#L127-L129'),
  ),

  // Text, captions and buttons of message content.
  messageTextEmpty: fixedBotApiError(
    400,
    'Bad Request: message text is empty',
    botApiServerSource('telegram-bot-api/Client.cpp#L12049'),
  ),
  /** A TDLib error about text, such as its entities, which varies with the text. */
  textInvalid: {
    status: () => 400,
    description: ({ textError }: { readonly textError: string }) =>
      badRequestDescription(textError),
    provenance: () => botApiServerSource('telegram-bot-api/Client.cpp#L73-L206'),
  },
  messageTextTooLong: fixedBotApiError(
    400,
    'Bad Request: message is too long',
    tdlibSource('td/telegram/MessageContent.cpp#L4809-L4812'),
  ),
  captionTooLong: fixedBotApiError(
    400,
    'Bad Request: message caption is too long',
    tdlibSource('td/telegram/MessageContent.cpp#L5293-L5295'),
  ),
  buttonDataInvalid: fixedBotApiError(
    400,
    'Bad Request: BUTTON_DATA_INVALID',
    telegramApiDocumentation('messages.sendMessage'),
  ),
  /** A button Telegram's servers do not allow in the chat, such as a Web App in a supergroup. */
  buttonTypeInvalid: fixedBotApiError(
    400,
    'Bad Request: BUTTON_TYPE_INVALID',
    telegramApiDocumentation('messages.sendMessage'),
  ),
  sendPermissionMissing: {
    status: () => 400,
    description: ({ contentKind }: { readonly contentKind: PermissionGovernedContent['kind'] }) =>
      SEND_PERMISSION_MISSING_DESCRIPTIONS[contentKind],
    provenance: () => tdlibSource('td/telegram/MessageContent.cpp#L6207-L6402'),
  },

  // Replies and effects of a sent message.
  replyMessageNotFound: fixedBotApiError(
    400,
    'Bad Request: message to be replied not found',
    botApiServerSource('telegram-bot-api/Client.cpp#L9192'),
  ),
  quoteTextInvalid: fixedBotApiError(
    400,
    'Bad Request: QUOTE_TEXT_INVALID',
    telegramApiDocumentation('messages.sendMessage'),
  ),
  messageEffectNotAllowedInChat: fixedBotApiError(
    400,
    "Bad Request: can't use message effects in the chat",
    tdlibSource('td/telegram/MessageSendOptions.cpp#L161-L170'),
  ),

  // Files a message sends.
  fileEmpty: fixedBotApiError(400, 'Bad Request: file must be non-empty', LOCAL_FILE_CHECKS),
  imageInvalid: fixedBotApiError(
    400,
    'Bad Request: IMAGE_PROCESS_FAILED',
    telegramApiDocumentation('messages.uploadMedia'),
  ),
  photoDimensionsInvalid: fixedBotApiError(
    400,
    'Bad Request: PHOTO_INVALID_DIMENSIONS',
    telegramApiDocumentation('messages.uploadMedia'),
  ),
  photoTooBig: {
    status: () => 400,
    description: ({ fileSizeBytes }: { readonly fileSizeBytes: number }) =>
      `Bad Request: file of size ${fileSizeBytes} bytes is too big for a photo; ` +
      `the maximum size is ${MAX_PHOTO_UPLOAD_BYTES} bytes`,
    provenance: () => LOCAL_FILE_CHECKS,
  },
  /**
   * A file larger than the session's Bot API server lets a bot upload. Telegram's own server
   * answers `413 Request Entity Too Large` without reading the request; a local server's limit is
   * enforced after the upload, with an error that is not in the source either.
   */
  botUploadTooBig: {
    status: ({ uploadProfile }: BotUploadTooBigFailure) => uploadProfile === 'cloud' ? 413 : 400,
    description: ({ uploadProfile, fileSizeBytes, maxFileSizeBytes }: BotUploadTooBigFailure) =>
      uploadProfile === 'cloud'
        ? 'Request Entity Too Large'
        : `Bad Request: file of size ${fileSizeBytes} bytes is too big; ` +
          `the maximum size is ${maxFileSizeBytes} bytes`,
    provenance: ({ uploadProfile }: BotUploadTooBigFailure) =>
      uploadProfile === 'cloud'
        ? observedBehavior(
          'api.telegram.org answers an oversized upload before its Bot API server reads it',
        )
        : emulatorInference(UPLOAD_LIMIT_INFERENCE),
  },
  fileIdInvalid: fixedBotApiError(
    400,
    'Bad Request: wrong file identifier/HTTP URL specified',
    tdlibSource('td/telegram/MessagesManager.cpp#L28131-L28138'),
  ),
  fileTypeMismatch: {
    status: () => 400,
    description: ({ expectedFileType, actualFileType }: {
      readonly expectedFileType: StoredFile['type'];
      readonly actualFileType: StoredFile['type'];
    }) =>
      `Bad Request: can't use file of type ${TDLIB_FILE_TYPE_NAMES[actualFileType]} as ${
        TDLIB_FILE_TYPE_NAMES[expectedFileType]
      }`,
    provenance: () => tdlibSource('td/telegram/files/FileManager.cpp#L4140-L4165'),
  },

  // Polls a message sends.
  pollQuestionTooLong: fixedBotApiError(
    400,
    `Bad Request: poll question length must not exceed ${MAX_POLL_QUESTION_LENGTH}`,
    tdlibSource('td/telegram/MessageContent.cpp#L5059-L5065'),
  ),
  pollOptionsMissing: fixedBotApiError(
    400,
    'Bad Request: poll must have at least one answer option',
    tdlibSource('td/telegram/PollOption.cpp#L56-L91'),
  ),
  pollHasTooManyOptions: fixedBotApiError(
    400,
    `Bad Request: poll can't have more than ${MAX_POLL_OPTION_COUNT} options`,
    tdlibSource('td/telegram/PollOption.cpp#L56-L91'),
  ),
  pollOptionTooLong: fixedBotApiError(
    400,
    `Bad Request: poll options length must not exceed ${MAX_POLL_OPTION_TEXT_LENGTH}`,
    tdlibSource('td/telegram/PollOption.cpp#L56-L91'),
  ),
  quizCorrectOptionsMissing: fixedBotApiError(
    400,
    'Bad Request: correct quiz option list must be non-empty',
    tdlibSource('td/telegram/PollManager.cpp#L453-L469'),
  ),
  quizCorrectOptionsNotIncreasing: fixedBotApiError(
    400,
    'Bad Request: correct quiz option list must be increasing',
    tdlibSource('td/telegram/PollManager.cpp#L453-L469'),
  ),
  quizCorrectOptionNotFound: fixedBotApiError(
    400,
    'Bad Request: wrong quiz correct_option_id',
    tdlibSource('td/telegram/PollManager.cpp#L453-L469'),
  ),
  quizExplanationTooLong: fixedBotApiError(
    400,
    `Bad Request: quiz explanation must have at most ${MAX_QUIZ_EXPLANATION_LENGTH} characters`,
    emulatorInference(DOCUMENTED_LIMIT_INFERENCE),
  ),
  quizExplanationHasTooManyLineFeeds: fixedBotApiError(
    400,
    `Bad Request: quiz explanation must have at most ${MAX_QUIZ_EXPLANATION_LINE_FEEDS} line feeds`,
    emulatorInference(DOCUMENTED_LIMIT_INFERENCE),
  ),
  pollOpenPeriodInvalid: fixedBotApiError(
    400,
    `Bad Request: open_period must be from ${MIN_POLL_OPEN_PERIOD_SECONDS} to ${MAX_POLL_OPEN_PERIOD_SECONDS} seconds`,
    emulatorInference(DOCUMENTED_LIMIT_INFERENCE),
  ),
  pollCloseDateInvalid: fixedBotApiError(
    400,
    `Bad Request: close_date must be from ${MIN_POLL_OPEN_PERIOD_SECONDS} to ${MAX_POLL_OPEN_PERIOD_SECONDS} seconds in the future`,
    emulatorInference(DOCUMENTED_LIMIT_INFERENCE),
  ),

  // Albums.
  albumEmpty: fixedBotApiError(
    400,
    'Bad Request: there are no messages to send',
    tdlibSource('td/telegram/MessageContent.cpp#L5378-L5406'),
  ),
  albumTooLarge: fixedBotApiError(
    400,
    'Bad Request: too many messages to send as an album',
    tdlibSource('td/telegram/MessageContent.cpp#L5378-L5406'),
  ),
  albumCaptionPlacementMixed: fixedBotApiError(
    400,
    'Bad Request: parameter show_caption_above_media must be the same for all messages',
    tdlibSource('td/telegram/MessageContent.cpp#L5378-L5406'),
  ),
  albumDocumentsMixed: fixedBotApiError(
    400,
    "Bad Request: document can't be mixed with other media types",
    tdlibSource('td/telegram/MessageContent.cpp#L5378-L5406'),
  ),
  albumAudioMixed: fixedBotApiError(
    400,
    "Bad Request: audio can't be mixed with other media types",
    tdlibSource('td/telegram/MessageContent.cpp#L5378-L5406'),
  ),
  /**
   * An album whose message Telegram's servers refused once the album was sent. The official
   * server's `on_message_send_failed` wraps their error with the message's position; the
   * provenance is that of the wrapped error, which varies with the refusal.
   */
  albumMemberUploadRefused: {
    status: () => 400,
    description: ({ memberPosition, refusal }: {
      readonly memberPosition: number;
      readonly refusal: AlbumMemberUploadRefusal;
    }) => describeAlbumMessageNotSent(memberPosition, describeAlbumMemberUploadRefusal(refusal)),
    provenance: ({ refusal }: { readonly refusal: AlbumMemberUploadRefusal }) =>
      refusal.reason === 'bot_upload_too_big'
        ? emulatorInference(UPLOAD_LIMIT_INFERENCE)
        : telegramApiDocumentation('messages.uploadMedia'),
  },

  // Drafts and chat actions.
  chatActionInvalid: fixedBotApiError(
    400,
    'Bad Request: wrong parameter action in request',
    botApiServerSource('telegram-bot-api/Client.cpp#L14573'),
  ),
  draftChatNotPrivate: fixedBotApiError(
    400,
    'Bad Request: TEXTDRAFT_PEER_INVALID',
    telegramApiDocumentation('messages.setTyping'),
  ),
  draftIdInvalid: fixedBotApiError(
    400,
    'Bad Request: RANDOM_ID_INVALID',
    observedBehavior('Telegram answers a draft without a draft_id so'),
  ),
  /** Telegram's servers, not TDLib, check a draft's length, with the wording of a message's. */
  draftTextTooLong: fixedBotApiError(
    400,
    'Bad Request: message is too long',
    observedBehavior('Telegram answers a draft longer than a message so'),
  ),

  // Edits of sent messages.
  messageIdentifierNotSpecified: fixedBotApiError(
    400,
    'Bad Request: message identifier is not specified',
    botApiServerSource('telegram-bot-api/Client.cpp#L13543'),
  ),
  messageToEditNotFound: fixedBotApiError(
    400,
    'Bad Request: message to edit not found',
    CHECK_MESSAGE,
  ),
  /** An unknown, deleted, or other bot's inline message. */
  inlineMessageIdInvalid: fixedBotApiError(
    400,
    'Bad Request: MESSAGE_ID_INVALID',
    telegramApiDocumentation('messages.editInlineBotMessage'),
  ),
  messageNotEditable: fixedBotApiError(
    400,
    "Bad Request: message can't be edited",
    tdlibSource('td/telegram/MessagesManager.cpp#L23514'),
  ),
  messageHasNoText: fixedBotApiError(
    400,
    'Bad Request: there is no text in the message to edit',
    tdlibSource('td/telegram/MessagesManager.cpp#L23521'),
  ),
  messageHasNoCaption: fixedBotApiError(
    400,
    'Bad Request: there is no caption in the message to edit',
    tdlibSource('td/telegram/MessagesManager.cpp#L23798'),
  ),
  /** A voice note, a poll, a contact, or a location, which `can_edit_message_media` refuses. */
  messageMediaNotEditable: fixedBotApiError(
    400,
    "Bad Request: message media can't be edited",
    tdlibSource('td/telegram/MessagesManager.cpp#L23732'),
  ),
  albumMediaTypeUnchangeable: fixedBotApiError(
    400,
    "Bad Request: can't change media type in the album",
    tdlibSource('td/telegram/MessagesManager.cpp#L23753'),
  ),
  messageNotModified: fixedBotApiError(
    400,
    'Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message',
    botApiServerSource('telegram-bot-api/Client.cpp#L110-L113'),
  ),
  /** New content of an inline message that uploads a file, which an inline message cannot take. */
  inlineMessageContentInvalid: fixedBotApiError(
    400,
    'Bad Request: invalid message content specified',
    tdlibSource('td/telegram/InlineMessageManager.cpp#L219-L261'),
  ),

  // Stopped polls.
  messageWithPollToStopNotFound: fixedBotApiError(
    400,
    'Bad Request: message with poll to stop not found',
    CHECK_MESSAGE,
  ),
  messageHasNoPoll: fixedBotApiError(
    400,
    'Bad Request: message is not a poll',
    tdlibSource('td/telegram/MessagesManager.cpp#L36625'),
  ),
  pollNotStoppable: fixedBotApiError(
    400,
    "Bad Request: poll can't be stopped",
    tdlibSource('td/telegram/MessagesManager.cpp#L36634'),
  ),
  pollAlreadyClosed: fixedBotApiError(
    400,
    'Bad Request: poll has already been closed',
    tdlibSource('td/telegram/PollManager.cpp#L1717-L1746'),
  ),

  // Forwards and copies of messages.
  messageToForwardNotFound: fixedBotApiError(
    400,
    'Bad Request: message to forward not found',
    CHECK_MESSAGE,
  ),
  messageToCopyNotFound: fixedBotApiError(
    400,
    'Bad Request: message to copy not found',
    CHECK_MESSAGE,
  ),
  messageNotForwardable: fixedBotApiError(
    400,
    "Bad Request: the message can't be forwarded",
    FORWARDED_MESSAGE_SKIPPED,
  ),
  messageNotCopyable: fixedBotApiError(
    400,
    "Bad Request: the message can't be copied",
    FORWARDED_MESSAGE_SKIPPED,
  ),
  /** TDLib words this alike for forwards and copies of several messages, which both forward. */
  noMessagesToForward: fixedBotApiError(
    400,
    'Bad Request: there are no messages to forward',
    tdlibSource('td/telegram/MessagesManager.cpp#L24824-L24826'),
  ),
  repeatedMessageIdsNotIncreasing: fixedBotApiError(
    400,
    'Bad Request: message identifiers must be in a strictly increasing order',
    tdlibSource('td/telegram/MessagesManager.cpp#L24653-L24655'),
  ),
  /** Every message of a forward or copy of several messages was skipped. */
  messagesNotForwardable: fixedBotApiError(
    400,
    "Bad Request: messages can't be forwarded",
    botApiServerSource('telegram-bot-api/Client.cpp#L6947-L6949'),
  ),
  /** A message effect on a forward or copy of more than one message. */
  messageEffectNotAllowedInMethod: fixedBotApiError(
    400,
    "Bad Request: can't use message effects in the method",
    tdlibSource('td/telegram/MessageSendOptions.cpp#L161-L170'),
  ),

  // Deleted messages.
  messageToDeleteNotFound: fixedBotApiError(
    400,
    'Bad Request: message to delete not found',
    CHECK_MESSAGE,
  ),
  /** The official server's wording of Telegram's `MESSAGE_DELETE_FORBIDDEN`. */
  messageNotDeletable: fixedBotApiError(
    400,
    "Bad Request: message can't be deleted",
    botApiServerSource('telegram-bot-api/Client.cpp#L151-L153'),
  ),

  // Pinned messages.
  messageToPinNotFound: fixedBotApiError(
    400,
    'Bad Request: message to pin not found',
    CHECK_MESSAGE,
  ),
  /**
   * A message to unpin that the chat does not have, or, for an unpin without a target, no pinned
   * message, which the official server's `TdOnGetChatPinnedMessageToUnpinCallback` words alike.
   */
  messageToUnpinNotFound: fixedBotApiError(
    400,
    'Bad Request: message to unpin not found',
    CHECK_MESSAGE,
  ),
  notEnoughRightsToManagePinnedMessages: fixedBotApiError(
    400,
    'Bad Request: not enough rights to manage pinned messages in the chat',
    tdlibSource('td/telegram/DialogManager.cpp#L2902-L2925'),
  ),
  serviceMessageNotPinnable: fixedBotApiError(
    400,
    "Bad Request: service messages can't be pinned",
    tdlibSource('td/telegram/MessagesManager.cpp#L23333-L23335'),
  ),
  /** Telegram's servers refuse a pin or an unpin that changes nothing. */
  pinnedMessagesNotModified: fixedBotApiError(
    400,
    'Bad Request: CHAT_NOT_MODIFIED',
    telegramApiDocumentation('messages.updatePinnedMessage'),
  ),

  // Reactions to messages.
  messageToReactNotFound: fixedBotApiError(
    400,
    'Bad Request: message to react not found',
    CHECK_MESSAGE,
  ),
  /** A reaction the message does not allow, such as a custom emoji, or a message without any. */
  reactionInvalid: fixedBotApiError(
    400,
    'Bad Request: REACTION_INVALID',
    telegramApiDocumentation('messages.sendReaction'),
  ),
  /** More reactions than a user may choose, or than a message may show. */
  reactionsTooMany: fixedBotApiError(
    400,
    'Bad Request: REACTIONS_TOO_MANY',
    telegramApiDocumentation('messages.sendReaction'),
  ),
  /** A member whom the supergroup does not let react. */
  reactionNotPermitted: fixedBotApiError(
    403,
    'Forbidden: CHAT_WRITE_FORBIDDEN',
    telegramApiDocumentation('messages.sendReaction'),
  ),
  privateChatReactionsUnsupported: fixedBotApiError(
    400,
    'Bad Request: reactions in private chats are not supported',
    emulatorInference('The emulator supports reactions in supergroups only'),
  ),

  // Parameters the emulator cannot read.
  /**
   * Parameters that do not fit a method's schema. Telegram ignores or coerces most of them; the
   * emulator rejects them, naming the first offending parameter's path when it knows it.
   */
  invalidMethodParameters: {
    status: () => 400,
    description: ({ methodName, parameterPath }: {
      readonly methodName: string;
      readonly parameterPath?: string;
    }) =>
      `Bad Request: invalid ${methodName} parameters${
        parameterPath === undefined ? '' : `: ${parameterPath}`
      }`,
    provenance: () =>
      emulatorInference(
        'Strict validation surfaces parameters Telegram would ignore or misread in tests',
      ),
  },
} as const satisfies Readonly<Record<string, BotApiErrorTemplate<never>>>;

/** The error Telegram's servers give for an album member's upload they refuse. */
function describeAlbumMemberUploadRefusal(refusal: AlbumMemberUploadRefusal): string {
  switch (refusal.reason) {
    case 'image_invalid':
      return 'IMAGE_PROCESS_FAILED';
    case 'photo_dimensions_invalid':
      return 'PHOTO_INVALID_DIMENSIONS';
    case 'bot_upload_too_big':
      return `File of size ${refusal.fileSizeBytes} bytes is too big; ` +
        `the maximum size is ${refusal.maxFileSizeBytes} bytes`;
    default: {
      const unhandledRefusal: never = refusal;
      throw new Error(`Unhandled refused upload: ${JSON.stringify(unhandledRefusal)}`);
    }
  }
}
